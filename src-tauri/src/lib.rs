mod audio;
mod keychain;
mod providers;
mod translate;
mod whisper;

use arboard::Clipboard;
use providers::{ModelInfo, ProviderConfig, TranslationProvider};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};


/// Application state shared across commands
pub struct AppState {
    pub is_recording: Mutex<bool>,
    pub anthropic_api_key: Mutex<Option<String>>,
    pub whisper_model_path: Mutex<Option<String>>,
    /// PID of the app that was frontmost when recording started
    #[cfg(target_os = "macos")]
    pub previous_app_pid: Mutex<Option<i32>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            is_recording: Mutex::new(false),
            anthropic_api_key: Mutex::new(None),
            whisper_model_path: Mutex::new(None),
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
    *state.is_recording.lock().unwrap()
}

/// Save the frontmost app PID so we can reactivate it after pasting
#[tauri::command]
fn save_frontmost_app(state: State<AppState>) {
    #[cfg(target_os = "macos")]
    {
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
                    *state.previous_app_pid.lock().unwrap() = Some(pid);
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
                            *state.previous_app_pid.lock().unwrap() = Some(app_pid);
                            return;
                        }
                    }
                    // If no active app found, try menuBarOwningApplication
                    let menu_app: cocoa::base::id = msg_send![workspace, menuBarOwningApplication];
                    if menu_app != cocoa::base::nil {
                        let menu_pid: i32 = msg_send![menu_app, processIdentifier];
                        if menu_pid != our_pid {
                            log::info!("[FOCUS] Using menu bar app PID: {}", menu_pid);
                            *state.previous_app_pid.lock().unwrap() = Some(menu_pid);
                        }
                    }
                }
            }
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
    let result = providers::translate(&config, &text, &source_language, &target_language).await;
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

/// Copy text to clipboard and simulate paste (Cmd+V on macOS)
#[tauri::command(rename_all = "camelCase")]
async fn copy_and_paste(text: String, app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    log::info!("[PASTE] Starting copy_and_paste, text length: {}", text.len());

    // Copy to clipboard
    let mut clipboard = Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
    clipboard.set_text(&text).map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
    log::info!("[PASTE] Clipboard set: {:?}", t0.elapsed());

    #[cfg(target_os = "macos")]
    {
        // Hide overlay if visible
        if let Some(window) = app_handle.get_webview_window("overlay") {
            let _ = window.hide();
            log::info!("[PASTE] Overlay hidden");
        }

        // Reactivate the app that was frontmost when recording started
        let saved_pid = state.previous_app_pid.lock().unwrap().take();
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
        log::info!("[PASTE] Focus switch: {:?}", t0.elapsed());

        // Wait for focus to settle + clipboard to propagate
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        log::info!("[PASTE] Focus wait done: {:?}", t0.elapsed());

        // Check accessibility permission before attempting paste
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        let is_trusted = unsafe { AXIsProcessTrusted() };
        if !is_trusted {
            log::error!("[PASTE] Accessibility permission not granted");
            return Err("Accessibility permission required for auto-paste. Enable it in System Settings > Privacy & Security > Accessibility.".to_string());
        }

        // Simulate Cmd+V via enigo (requires Accessibility permission)
        match simulate_paste_macos() {
            Ok(_) => log::info!("[PASTE] Paste simulated: {:?}", t0.elapsed()),
            Err(e) => log::error!("[PASTE] Paste simulation failed: {}", e),
        }
        log::info!("[PASTE] Complete: {:?}", t0.elapsed());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_handle;
        return Err("Auto-paste only supported on macOS".to_string());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn simulate_paste_macos() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to create enigo: {}", e))?;

    // Simulate Cmd+V
    enigo.key(Key::Meta, Direction::Press)
        .map_err(|e| format!("Failed to press Meta: {}", e))?;
    enigo.key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("Failed to click V: {}", e))?;
    enigo.key(Key::Meta, Direction::Release)
        .map_err(|e| format!("Failed to release Meta: {}", e))?;

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
