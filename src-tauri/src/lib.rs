mod audio;
mod keychain;
mod providers;
mod translate;
mod whisper;

use arboard::Clipboard;
use audio::RecordingHandle;
use providers::{ModelInfo, ProviderConfig, TranslationProvider};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use whisper_rs::WhisperContext;


/// Application state shared across commands
pub struct AppState {
    /// Active recording handle; presence signals that recording is in progress.
    /// Using the handle itself as the source of truth eliminates the TOCTOU race
    /// that existed when `is_recording: Mutex<bool>` was kept separately.
    pub(crate) recording_handle: Mutex<Option<RecordingHandle>>,
    pub anthropic_api_key: Mutex<Option<String>>,
    pub whisper_model_path: Mutex<Option<String>>,
    /// Shared HTTP client with connection pooling (avoids creating a new client per request)
    pub http_client: reqwest::Client,
    /// Cached Whisper context: (model_name, context) for cache invalidation on model change
    pub whisper_context: Mutex<Option<(String, WhisperContext)>>,
    /// PID of the app that was frontmost when recording started
    #[cfg(target_os = "macos")]
    pub previous_app_pid: Mutex<Option<i32>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            recording_handle: Mutex::new(None),
            anthropic_api_key: Mutex::new(None),
            whisper_model_path: Mutex::new(None),
            http_client: reqwest::Client::new(),
            whisper_context: Mutex::new(None),
            #[cfg(target_os = "macos")]
            previous_app_pid: Mutex::new(None),
        }
    }
}

/// Translation entry for history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationEntry {
    pub id: String,
    pub original_text: String,
    pub translated_text: String,
    pub source_language: String,
    pub target_language: String,
    pub timestamp: String,
}

/// Settings for the application
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub recording_mode: String,           // "push_to_talk" or "click_to_record"
    pub whisper_model: String,            // "small", "medium", "large"
    pub source_language: String,          // "auto", "en", "es", etc.
    pub target_language: String,
    pub translation_provider: String,     // "anthropic", "openai", "google", "ollama"
    pub translation_model: Option<String>, // Optional model override
    #[serde(default = "default_translation_enabled")]
    pub translation_enabled: bool,        // Enable/disable translation (transcription-only mode)
    #[serde(default = "default_remove_filler_words")]
    pub remove_filler_words: bool,        // Remove um, uh, like, etc. from transcriptions
    #[serde(default = "default_global_hotkey_enabled")]
    pub global_hotkey_enabled: bool,      // Enable system-wide hotkey for recording
    #[serde(default = "default_global_hotkey")]
    pub global_hotkey: String,            // The hotkey combination (e.g., "CommandOrControl+Shift+Space")
    #[serde(default = "default_double_tap_interval")]
    pub double_tap_interval: u32,         // Milliseconds between taps for double-tap mode
}

fn default_translation_enabled() -> bool {
    true
}

fn default_remove_filler_words() -> bool {
    false
}

fn default_global_hotkey_enabled() -> bool {
    false
}

fn default_global_hotkey() -> String {
    "CommandOrControl+Shift+Space".to_string()
}

fn default_double_tap_interval() -> u32 {
    400
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            recording_mode: "click_to_record".to_string(),
            whisper_model: "large-v3-turbo".to_string(),
            source_language: "auto".to_string(),  // Default to auto-detect
            target_language: "en".to_string(),
            translation_provider: "openai".to_string(), // Default to GPT-4o-mini (cheapest)
            translation_model: None,
            translation_enabled: true,
            remove_filler_words: false,
            global_hotkey_enabled: false,
            global_hotkey: "CommandOrControl+Shift+Space".to_string(),
            double_tap_interval: 400,
        }
    }
}

// Re-export commands from modules
pub use audio::{get_audio_devices, start_recording, stop_recording};
pub use keychain::{delete_api_key, get_api_key, save_api_key, validate_api_key};
pub use whisper::{download_whisper_model, get_whisper_model_status, transcribe_audio};

/// Check if the app is currently recording
#[tauri::command]
fn is_recording(state: State<AppState>) -> bool {
    state
        .recording_handle
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
}

/// Save the frontmost app PID so we can reactivate it after pasting
#[tauri::command]
async fn save_frontmost_app(app_handle: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        // Clone app_handle so it can be moved into the 'static closure
        let handle = app_handle.clone();

        let result = app_handle.run_on_main_thread(move || {
            let state: State<AppState> = handle.state();
            unsafe {
                use objc::{msg_send, sel, sel_impl, class};

                // Get our own PID to exclude it
                let our_pid: i32 = std::process::id() as i32;

                let workspace: cocoa::base::id = msg_send![class!(NSWorkspace), sharedWorkspace];
                let frontmost: cocoa::base::id = msg_send![workspace, frontmostApplication];
                if frontmost != cocoa::base::nil {
                    let pid: i32 = msg_send![frontmost, processIdentifier];
                    if pid != our_pid {
                        log::info!("[FOCUS] Saved frontmost app PID: {} (not us: {})", pid, our_pid);
                        *state.previous_app_pid.lock().unwrap_or_else(|e| e.into_inner()) = Some(pid);
                    } else {
                        // Frontmost is us — look through running apps for the most recently active one
                        log::info!("[FOCUS] Frontmost is us (PID {}), searching for previous app...", our_pid);
                        let running_apps: cocoa::base::id = msg_send![workspace, runningApplications];
                        let count: usize = msg_send![running_apps, count];
                        for i in 0..count {
                            let app: cocoa::base::id = msg_send![running_apps, objectAtIndex: i];
                            let app_pid: i32 = msg_send![app, processIdentifier];
                            let is_active: cocoa::base::BOOL = msg_send![app, isActive];
                            let activation_policy: i64 = msg_send![app, activationPolicy];
                            // activationPolicy 0 = regular app (has dock icon)
                            if app_pid != our_pid && activation_policy == 0 && is_active != cocoa::base::NO {
                                log::info!("[FOCUS] Found active app PID: {}", app_pid);
                                *state.previous_app_pid.lock().unwrap_or_else(|e| e.into_inner()) = Some(app_pid);
                                return;
                            }
                        }
                        // If no active app found, try menuBarOwningApplication
                        let menu_app: cocoa::base::id = msg_send![workspace, menuBarOwningApplication];
                        if menu_app != cocoa::base::nil {
                            let menu_pid: i32 = msg_send![menu_app, processIdentifier];
                            if menu_pid != our_pid {
                                log::info!("[FOCUS] Using menu bar app PID: {}", menu_pid);
                                *state.previous_app_pid.lock().unwrap_or_else(|e| e.into_inner()) = Some(menu_pid);
                            }
                        }
                    }
                }
            }
        });

        if let Err(e) = result {
            log::error!("[FOCUS] run_on_main_thread failed: {:?}", e);
        }
    }
}

/// Get the settings file path
fn get_settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_dir = home.join(".whisper-translate");
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    Ok(config_dir.join("settings.json"))
}

/// Get current app settings
#[tauri::command]
fn get_settings() -> AppSettings {
    match get_settings_path() {
        Ok(path) => {
            if path.exists() {
                match fs::read_to_string(&path) {
                    Ok(content) => {
                        match serde_json::from_str(&content) {
                            Ok(settings) => {
                                log::info!("Loaded settings from {:?}", path);
                                settings
                            }
                            Err(e) => {
                                log::warn!("Failed to parse settings file: {}. Using defaults.", e);
                                AppSettings::default()
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to read settings file: {}. Using defaults.", e);
                        AppSettings::default()
                    }
                }
            } else {
                log::info!("No settings file found, using defaults");
                AppSettings::default()
            }
        }
        Err(e) => {
            log::warn!("Failed to get settings path: {}. Using defaults.", e);
            AppSettings::default()
        }
    }
}

/// Save app settings
#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = get_settings_path()?;
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;
    log::info!("Settings saved to {:?}", path);
    Ok(())
}

/// Translate text using the specified provider
#[tauri::command(rename_all = "camelCase")]
async fn translate_text(
    text: String,
    source_language: String,
    target_language: String,
    provider: String,
    model: Option<String>,
    api_key: Option<String>,
    state: State<'_, AppState>,
) -> Result<providers::TranslationResult, String> {
    let translation_provider = match provider.as_str() {
        "anthropic" => TranslationProvider::Anthropic,
        "openai" => TranslationProvider::OpenAI,
        "google" => TranslationProvider::Google,
        "ollama" => TranslationProvider::Ollama,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let config = ProviderConfig {
        provider: translation_provider,
        model,
        api_key,
        ollama_url: None, // Use default localhost:11434
    };

    let t0 = std::time::Instant::now();
    let result = providers::translate(&state.http_client, &config, &text, &source_language, &target_language).await;
    log::info!("[TIMING] Translation ({} via {}): {:?}", provider, config.model.as_deref().unwrap_or("default"), t0.elapsed());
    result
}

/// Get available models for a provider
#[tauri::command]
fn get_provider_models(provider: String) -> Result<Vec<ModelInfo>, String> {
    let translation_provider = match provider.as_str() {
        "anthropic" => TranslationProvider::Anthropic,
        "openai" => TranslationProvider::OpenAI,
        "google" => TranslationProvider::Google,
        "ollama" => TranslationProvider::Ollama,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    Ok(translation_provider.available_models())
}

/// Get provider information (API key URL, whether key is required, etc.)
#[tauri::command]
fn get_provider_info(provider: String) -> Result<ProviderInfo, String> {
    let translation_provider = match provider.as_str() {
        "anthropic" => TranslationProvider::Anthropic,
        "openai" => TranslationProvider::OpenAI,
        "google" => TranslationProvider::Google,
        "ollama" => TranslationProvider::Ollama,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    Ok(ProviderInfo {
        api_key_url: translation_provider.api_key_url().to_string(),
        requires_api_key: translation_provider.requires_api_key(),
        default_model: translation_provider.default_model().to_string(),
    })
}

#[derive(Debug, Serialize)]
pub struct ProviderInfo {
    pub api_key_url: String,
    pub requires_api_key: bool,
    pub default_model: String,
}

/// Check if Ollama is running
#[tauri::command]
async fn check_ollama_status() -> Result<OllamaStatus, String> {
    let is_running = providers::check_ollama_running().await;

    if is_running {
        match providers::list_ollama_models().await {
            Ok(models) => Ok(OllamaStatus {
                is_running: true,
                models: models.into_iter().map(|m| m.name).collect(),
                error: None,
            }),
            Err(e) => Ok(OllamaStatus {
                is_running: true,
                models: vec![],
                error: Some(e),
            }),
        }
    } else {
        Ok(OllamaStatus {
            is_running: false,
            models: vec![],
            error: Some("Ollama is not running".to_string()),
        })
    }
}

#[derive(Debug, Serialize)]
pub struct OllamaStatus {
    pub is_running: bool,
    pub models: Vec<String>,
    pub error: Option<String>,
}

/// Copy text to clipboard and switch focus back to the previously active app
#[tauri::command(rename_all = "camelCase")]
async fn copy_and_paste(text: String, app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    log::info!("[PASTE] Starting copy_and_paste, text length: {}", text.len());

    // Copy to clipboard (arboard is safe from any thread)
    let mut clipboard = Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
    clipboard.set_text(&text).map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
    log::info!("[PASTE] Clipboard set: {:?}", t0.elapsed());

    #[cfg(target_os = "macos")]
    {
        // Hide overlay if visible (Tauri API is safe from any thread)
        if let Some(window) = app_handle.get_webview_window("overlay") {
            let _ = window.hide();
            log::info!("[PASTE] Overlay hidden");
        }

        // Take the saved PID before moving into the closure
        let saved_pid = state.previous_app_pid.lock().unwrap_or_else(|e| e.into_inner()).take();

        // AppKit/NSRunningApplication calls MUST run on the main thread
        let result = app_handle.run_on_main_thread(move || {
            if let Some(pid) = saved_pid {
                log::info!("[PASTE] Reactivating app with PID: {}", pid);
                unsafe {
                    use objc::{msg_send, sel, sel_impl, class};
                    let running_app: cocoa::base::id = msg_send![
                        class!(NSRunningApplication),
                        runningApplicationWithProcessIdentifier: pid
                    ];
                    if running_app != cocoa::base::nil {
                        // NSApplicationActivateIgnoringOtherApps = 1 << 1 = 2
                        let success: cocoa::base::BOOL = msg_send![
                            running_app,
                            activateWithOptions: 2u64
                        ];
                        log::info!("[PASTE] App activation result: {}", success);
                    } else {
                        log::warn!("[PASTE] Could not find app with PID {}", pid);
                    }
                }
            } else {
                log::warn!("[PASTE] No saved frontmost app PID, hiding NSApp as fallback");
                unsafe {
                    use objc::{msg_send, sel, sel_impl};
                    let ns_app: cocoa::base::id = msg_send![cocoa::appkit::NSApp(), self];
                    let _: () = msg_send![ns_app, hide: cocoa::base::nil];
                }
            }
        });

        if let Err(e) = result {
            log::error!("[PASTE] run_on_main_thread failed: {:?}", e);
        }

        log::info!("[PASTE] Focus switch dispatched: {:?}", t0.elapsed());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_handle;
        let _ = state;
        return Err("Focus switch only supported on macOS".to_string());
    }

    Ok(())
}

/// Show the floating recording overlay window
#[tauri::command]
async fn show_overlay(app_handle: AppHandle) -> Result<(), String> {
    // Check if overlay window already exists
    if let Some(window) = app_handle.get_webview_window("overlay") {
        window.show().map_err(|e| format!("Failed to show overlay: {}", e))?;
        return Ok(());
    }

    // Get primary monitor for positioning
    let monitor = app_handle
        .primary_monitor()
        .map_err(|e| format!("Failed to get monitor: {}", e))?
        .ok_or("No primary monitor found")?;

    let monitor_width = monitor.size().width as f64 / monitor.scale_factor();
    let x = (monitor_width - 340.0) / 2.0;

    // Create new overlay window
    let _overlay = WebviewWindowBuilder::new(&app_handle, "overlay", WebviewUrl::App("index.html".into()))
        .title("Recording")
        .inner_size(340.0, 72.0)
        .position(x, 24.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .focused(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(true)
        .build()
        .map_err(|e| format!("Failed to create overlay window: {}", e))?;

    Ok(())
}

/// Hide the floating recording overlay window
#[tauri::command]
async fn hide_overlay(app_handle: AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("overlay") {
        window.close().map_err(|e| format!("Failed to close overlay: {}", e))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Log to file so we can debug without Terminal (which steals mic permission)
    let log_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".whisper-translate")
        .join("app.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path);

    let mut builder = env_logger::Builder::from_default_env();
    builder.filter_level(log::LevelFilter::Info);
    if let Ok(file) = log_file {
        builder.target(env_logger::Target::Pipe(Box::new(file)));
    }
    builder.init();
    log::info!("Log file: {}", log_path.display());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_macos_permissions::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // Audio commands
            start_recording,
            stop_recording,
            get_audio_devices,
            is_recording,
            // Keychain commands
            save_api_key,
            get_api_key,
            delete_api_key,
            validate_api_key,
            // Whisper commands
            transcribe_audio,
            download_whisper_model,
            get_whisper_model_status,
            // Translation commands
            translate_text,
            get_provider_models,
            get_provider_info,
            check_ollama_status,
            // Settings commands
            get_settings,
            save_settings,
            // Clipboard commands
            copy_and_paste,
            save_frontmost_app,
            // Overlay commands
            show_overlay,
            hide_overlay,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
