use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

use super::{build_translation_prompt, TranslationResult};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/chat/completions";

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: String,
}

/// Translate text using OpenAI API
pub async fn translate(
    text: &str,
    source_language: &str,
    target_language: &str,
    api_key: &str,
    model: &str,
) -> Result<TranslationResult, String> {
    if api_key.is_empty() {
        return Err("OpenAI API key not configured".to_string());
    }

    let prompt = build_translation_prompt(text, source_language, target_language);

    let request = OpenAIRequest {
        model: model.to_string(),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
        }],
        max_tokens: 4096,
    };

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key))
            .map_err(|_| "Invalid API key format")?,
    );

    let client = reqwest::Client::new();
    let response = client
        .post(OPENAI_API_URL)
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
        return Err(format!("OpenAI API error ({}): {}", status, error_text));
    }

    let api_response: OpenAIResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let translated_text = api_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or("No translation received from OpenAI API")?;

    if translated_text.is_empty() {
        return Err("Empty translation received from OpenAI API".to_string());
    }

    log::info!(
        "OpenAI translation complete: {} -> {} ({} chars)",
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
