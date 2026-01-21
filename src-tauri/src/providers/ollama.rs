use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

use super::{build_translation_prompt, TranslationResult};

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    response: String,
    #[allow(dead_code)]
    done: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub modified_at: String,
}

/// Check if Ollama is running
pub async fn check_ollama_running() -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_default();

    client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .is_ok()
}

/// List available Ollama models
pub async fn list_ollama_models() -> Result<Vec<OllamaModel>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "Ollama is not running. Please start Ollama first.".to_string()
            } else {
                format!("Failed to connect to Ollama: {}", e)
            }
        })?;

    if !response.status().is_success() {
        return Err(format!(
            "Ollama API error ({})",
            response.status()
        ));
    }

    let tags_response: OllamaTagsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    Ok(tags_response.models)
}

/// Translate text using Ollama (local LLM)
pub async fn translate(
    text: &str,
    source_language: &str,
    target_language: &str,
    base_url: &str,
    model: &str,
) -> Result<TranslationResult, String> {
    let prompt = build_translation_prompt(text, source_language, target_language);

    let url = format!("{}/api/generate", base_url);

    let request = OllamaRequest {
        model: model.to_string(),
        prompt,
        stream: false,
    };

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120)) // Longer timeout for local models
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .post(&url)
        .headers(headers)
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "Ollama is not running. Please start Ollama first (run 'ollama serve' in terminal)."
                    .to_string()
            } else if e.is_timeout() {
                "Translation timed out. The model may be too slow for this text length.".to_string()
            } else {
                format!("Failed to send request to Ollama: {}", e)
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());

        // Check for common errors
        if error_text.contains("model") && error_text.contains("not found") {
            return Err(format!(
                "Model '{}' not found. Run 'ollama pull {}' to download it.",
                model, model
            ));
        }

        return Err(format!("Ollama error ({}): {}", status, error_text));
    }

    let api_response: OllamaResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let translated_text = api_response.response.trim().to_string();

    if translated_text.is_empty() {
        return Err("No translation received from Ollama".to_string());
    }

    log::info!(
        "Ollama translation complete: {} -> {} ({} chars)",
        source_language,
        target_language,
        translated_text.len()
    );

    Ok(TranslationResult {
        translated_text,
        source_language: source_language.to_string(),
        target_language: target_language.to_string(),
    })
}
