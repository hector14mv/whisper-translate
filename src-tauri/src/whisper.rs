use futures::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::AppState;

/// Whisper model information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperModelInfo {
    pub name: String,
    pub size_mb: u64,
    pub downloaded: bool,
    pub path: Option<String>,
}

/// Get the models directory
fn get_models_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let models_dir = home.join(".whisper-translate").join("models");
    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;
    Ok(models_dir)
}

/// Get the path for a specific model
fn get_model_path(model_name: &str) -> Result<PathBuf, String> {
    let models_dir = get_models_dir()?;
    Ok(models_dir.join(format!("ggml-{}.bin", model_name)))
}

/// Check if a model is downloaded
fn is_model_downloaded(model_name: &str) -> Result<bool, String> {
    let model_path = get_model_path(model_name)?;
    Ok(model_path.exists())
}

/// Get Whisper model download status
#[tauri::command]
pub fn get_whisper_model_status() -> Result<Vec<WhisperModelInfo>, String> {
    let models = vec![
        ("large-v3-turbo", 1549),   // ~1.55 GB - best speed/quality balance
        ("large-v3", 2951),         // ~2.95 GB - highest quality
    ];

    let mut result = Vec::new();
    for (name, size_mb) in models {
        let downloaded = is_model_downloaded(name)?;
        let path = if downloaded {
            Some(get_model_path(name)?.to_string_lossy().to_string())
        } else {
            None
        };
        result.push(WhisperModelInfo {
            name: name.to_string(),
            size_mb,
            downloaded,
            path,
        });
    }

    Ok(result)
}

/// Download progress event payload
#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    model: String,
    downloaded: u64,
    total: u64,
    percent: f32,
}

/// Download a Whisper model from Hugging Face
#[tauri::command(rename_all = "camelCase")]
pub async fn download_whisper_model(model_name: String, app_handle: AppHandle) -> Result<String, String> {
    let valid_models = ["large-v3-turbo", "large-v3"];
    if !valid_models.contains(&model_name.as_str()) {
        return Err(format!("Invalid model name: {}", model_name));
    }

    let model_path = get_model_path(&model_name)?;

    // Check if already downloaded
    if model_path.exists() {
        return Ok(model_path.to_string_lossy().to_string());
    }

    // Download from Hugging Face
    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model_name
    );

    log::info!("Downloading Whisper model from: {}", url);

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to download model: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download model: HTTP {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = std::fs::File::create(&model_path)
        .map_err(|e| format!("Failed to create model file: {}", e))?;

    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Failed to read chunk: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write chunk: {}", e))?;

        downloaded += chunk.len() as u64;

        let percent = if total_size > 0 {
            (downloaded as f32 / total_size as f32) * 100.0
        } else {
            0.0
        };

        let _ = app_handle.emit("download-progress", DownloadProgress {
            model: model_name.clone(),
            downloaded,
            total: total_size,
            percent,
        });
    }

    log::info!("Model downloaded to: {:?}", model_path);
    Ok(model_path.to_string_lossy().to_string())
}

/// Transcribe audio file using Whisper
#[tauri::command(rename_all = "camelCase")]
pub async fn transcribe_audio(
    audio_path: String,
    model_name: String,
    #[allow(unused_variables)]
    remove_filler_words: Option<bool>,
    state: State<'_, AppState>,
) -> Result<TranscriptionResult, String> {
    let model_path = get_model_path(&model_name)?;

    if !model_path.exists() {
        return Err(format!("Model {} not downloaded", model_name));
    }

    let model_path_str = model_path
        .to_str()
        .ok_or("Invalid model path: non-UTF-8 characters")?;

    let total_start = std::time::Instant::now();

    // Load or reuse cached Whisper model context
    let t0 = std::time::Instant::now();
    let mut ctx_guard = state
        .whisper_context
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    // Check if there is a cached context for the same model; otherwise load from disk.
    // We inspect the cached name before taking ownership to avoid unnecessary moves.
    let is_cache_hit = matches!(ctx_guard.as_ref(), Some((name, _)) if name == &model_name);
    let ctx = if is_cache_hit {
        let (_, ctx) = ctx_guard.take().expect("cache hit but Option was None");
        log::info!("[TIMING] Model cache hit ({}), skipping load", model_name);
        ctx
    } else {
        // Drop stale entry (different model or first run) before loading
        *ctx_guard = None;
        log::info!("[TIMING] Model cache miss, loading from disk...");
        WhisperContext::new_with_params(model_path_str, WhisperContextParameters::default())
            .map_err(|e| format!("Failed to load Whisper model: {}", e))?
    };

    // Release the lock while doing transcription — this is the slow part
    drop(ctx_guard);

    log::info!("[TIMING] Model load/cache: {:?}", t0.elapsed());

    // Read the audio file
    let t0 = std::time::Instant::now();
    let audio_data = read_wav_file(&audio_path)?;
    let duration_secs = audio_data.len() as f32 / 16000.0;
    log::info!("[TIMING] WAV read: {:?} ({:.1}s of audio, {} samples)", t0.elapsed(), duration_secs, audio_data.len());

    // Create Whisper parameters
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

    // Configure for translation and language detection
    params.set_language(Some("auto")); // Auto-detect language
    params.set_translate(false); // We'll use the translation provider for translation
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    // Create whisper_state and run inference
    let mut whisper_state = ctx.create_state().map_err(|e| format!("Failed to create state: {}", e))?;

    let t0 = std::time::Instant::now();
    whisper_state
        .full(params, &audio_data)
        .map_err(|e| format!("Transcription failed: {}", e))?;
    log::info!("[TIMING] Whisper inference: {:?}", t0.elapsed());

    // Get the transcribed text
    let num_segments = whisper_state.full_n_segments();
    let mut text = String::new();

    for i in 0..num_segments {
        if let Some(segment) = whisper_state.get_segment(i) {
            let no_speech = segment.no_speech_probability();
            if let Ok(segment_text) = segment.to_str_lossy() {
                log::info!("[WHISPER] Segment {}: no_speech={:.3}, text=\"{}\"", i, no_speech, segment_text.trim());
                // Skip segments that are likely silence/hallucination
                if no_speech > 0.6 {
                    log::info!("[WHISPER] Skipping segment {} (no_speech too high)", i);
                    continue;
                }
                text.push_str(&segment_text);
                text.push(' ');
            }
        }
    }

    // Check audio RMS to detect total silence (e.g. mic permission denied = 0.0)
    let rms: f32 = (audio_data.iter().map(|s| s * s).sum::<f32>() / audio_data.len() as f32).sqrt();
    log::info!("[WHISPER] Audio RMS: {:.6}", rms);
    if rms < 0.0001 {
        log::warn!("[WHISPER] Audio is silence (RMS={:.6}), mic may not be working", rms);
        text.clear();
    }

    let mut text = text.trim().to_string();

    // Always remove Whisper artifacts like [silence], [music], etc.
    text = remove_whisper_artifacts(&text);

    // Remove filler words if requested
    if remove_filler_words.unwrap_or(false) {
        text = remove_filler_words_from_text(&text);
    }

    // Try to detect the language (simplified - Whisper does this automatically)
    let detected_language = detect_language(&text);

    log::info!(
        "[TIMING] Total transcription: {:?} | {} chars, detected language: {}",
        total_start.elapsed(),
        text.len(),
        detected_language
    );

    // Put the context back into the cache for next invocation
    let mut ctx_guard = state
        .whisper_context
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    *ctx_guard = Some((model_name.to_string(), ctx));
    drop(ctx_guard);

    Ok(TranscriptionResult {
        text,
        detected_language,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub detected_language: String,
}

/// Read a WAV file and convert to f32 samples
fn read_wav_file(path: &str) -> Result<Vec<f32>, String> {
    let mut reader =
        hound::WavReader::open(path).map_err(|e| format!("Failed to open WAV file: {}", e))?;

    let spec = reader.spec();
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .filter_map(|s| s.ok())
            .collect(),
        hound::SampleFormat::Int => {
            let max_value = (1 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .filter_map(|s| s.ok())
                .map(|s| s as f32 / max_value)
                .collect()
        }
    };

    // If stereo, convert to mono
    let samples = if spec.channels == 2 {
        samples
            .chunks(2)
            .map(|chunk| (chunk[0] + chunk.get(1).unwrap_or(&0.0)) / 2.0)
            .collect()
    } else {
        samples
    };

    // Resample to 16kHz if needed (Whisper expects 16kHz)
    let samples = if spec.sample_rate != 16000 {
        resample(&samples, spec.sample_rate, 16000)
    } else {
        samples
    };

    Ok(samples)
}

/// Simple linear resampling
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let ratio = from_rate as f64 / to_rate as f64;
    let new_len = (samples.len() as f64 / ratio) as usize;
    let mut result = Vec::with_capacity(new_len);

    for i in 0..new_len {
        let src_idx = i as f64 * ratio;
        let idx = src_idx as usize;
        let frac = src_idx - idx as f64;

        let sample = if idx + 1 < samples.len() {
            samples[idx] * (1.0 - frac as f32) + samples[idx + 1] * frac as f32
        } else {
            samples[idx]
        };

        result.push(sample);
    }

    result
}

/// Simple language detection based on common patterns
fn detect_language(text: &str) -> String {
    // Simple heuristic based on character patterns
    let text_lower = text.to_lowercase();

    // Spanish indicators
    let spanish_patterns = ["que", "de", "la", "el", "en", "es", "un", "por", "con", "para", "¿", "¡", "ñ"];
    let spanish_count: usize = spanish_patterns
        .iter()
        .map(|p| text_lower.matches(p).count())
        .sum();

    // English indicators
    let english_patterns = ["the", "is", "are", "was", "were", "have", "has", "will", "would", "could"];
    let english_count: usize = english_patterns
        .iter()
        .map(|p| text_lower.matches(p).count())
        .sum();

    if spanish_count > english_count {
        "es".to_string()
    } else {
        "en".to_string()
    }
}

/// Remove Whisper artifacts like [silence], [music], [door closing], etc.
fn remove_whisper_artifacts(text: &str) -> String {
    // Remove bracketed annotations that Whisper adds
    let artifact_pattern = Regex::new(r"\[[^\]]*\]").unwrap();
    let result = artifact_pattern.replace_all(text, "").to_string();

    // Clean up multiple spaces
    let multi_space = Regex::new(r"\s{2,}").unwrap();
    multi_space.replace_all(&result, " ").trim().to_string()
}

/// Remove filler words from transcribed text (multilingual)
fn remove_filler_words_from_text(text: &str) -> String {
    // Filler words in multiple languages
    // English: um, uh, er, ah, like, you know, i mean, sort of, kind of, basically, actually, literally, hmm, eh
    // Spanish: este, o sea, pues, bueno, eh, mmm
    // French: euh, ben, genre, en fait
    // German: ähm, äh, also, halt, sozusagen
    let filler_patterns = [
        // English fillers (standalone words)
        r"\b(um+|uh+|er+|ah+|hmm+|eh+|mhm+)\b",
        r"\b(like)\b(?!\s+(?:a|to|the|this|that|it|when|if|because))",  // "like" only when standalone filler
        r"\byou know\b",
        r"\bi mean\b",
        r"\bsort of\b",
        r"\bkind of\b",
        r"\bbasically\b",
        r"\bactually\b",
        r"\bliterally\b",
        // Spanish fillers
        r"\b(este|esto)\b(?!\s+\w)",  // "este" only when standalone
        r"\bo sea\b",
        r"\bpues\b(?!\s+(?:sí|no|bien|claro))",  // "pues" when not part of phrase
        r"\bbueno\b(?!\s+(?:día|días))",  // "bueno" when not "buenos días"
        // French fillers
        r"\beuh+\b",
        r"\bben\b",
        r"\bgenre\b(?!\s+de)",  // "genre" when not "genre de"
        r"\ben fait\b",
        // German fillers
        r"\b(ähm+|äh+)\b",
        r"\balso\b(?!\s+(?:gut|dann|wenn))",  // "also" when standalone
        r"\bhalt\b",
        r"\bsozusagen\b",
    ];

    let mut result = text.to_string();

    for pattern in &filler_patterns {
        if let Ok(re) = Regex::new(&format!("(?i){}", pattern)) {
            result = re.replace_all(&result, "").to_string();
        }
    }

    // Clean up multiple spaces and trim
    if let Ok(multi_space) = Regex::new(r"\s{2,}") {
        result = multi_space.replace_all(&result, " ").to_string();
    }

    // Clean up punctuation spacing (e.g., " ," -> ",")
    if let Ok(punct_space) = Regex::new(r"\s+([,\.!\?])") {
        result = punct_space.replace_all(&result, "$1").to_string();
    }

    result.trim().to_string()
}
