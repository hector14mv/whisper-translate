use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

use super::{build_translation_prompt, TranslationResult};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

/// Translate text using Claude API
pub async fn translate(
    text: &str,
    source_language: &str,
    target_language: &str,
    api_key: &str,
    model: &str,
) -> Result<TranslationResult, String> {
    if api_key.is_empty() {
        return Err("Anthropic API key not configured".to_string());
    }

    let prompt = build_translation_prompt(text, source_language, target_language);

    let request = AnthropicRequest {
        model: model.to_string(),
        max_tokens: 4096,
        messages: vec![Message {
            role: "user".to_string(),
            content: prompt,
        }],
    };

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key).map_err(|_| "Invalid API key format")?,
    );
    headers.insert(
        "anthropic-version",
        HeaderValue::from_static(ANTHROPIC_VERSION),
    );

    let client = reqwest::Client::new();
    let response = client
        .post(ANTHROPIC_API_URL)
        .headers(headers)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Anthropic API error ({}): {}", status, error_text));
    }

    let api_response: AnthropicResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let translated_text = api_response
        .content
        .into_iter()
        .filter(|block| block.content_type == "text")
        .filter_map(|block| block.text)
        .collect::<Vec<_>>()
        .join("");

    if translated_text.is_empty() {
        return Err("No translation received from Anthropic API".to_string());
    }

    log::info!(
        "Anthropic translation complete: {} -> {} ({} chars)",
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

/// Placeholder function - Ollama check is in ollama.rs
pub async fn check_ollama_running() -> bool {
    super::ollama::check_ollama_running().await
}
