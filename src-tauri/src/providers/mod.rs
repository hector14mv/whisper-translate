mod anthropic;
mod google;
mod ollama;
mod openai;

use serde::{Deserialize, Serialize};

/// Supported translation providers
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TranslationProvider {
    Anthropic,
    OpenAI,
    Google,
    Ollama,
}

impl Default for TranslationProvider {
    fn default() -> Self {
        TranslationProvider::OpenAI // GPT-4o-mini is the cheapest
    }
}

impl TranslationProvider {
    /// Get the default model for this provider
    pub fn default_model(&self) -> &'static str {
        match self {
            TranslationProvider::Anthropic => "claude-3-5-haiku-20241022",
            TranslationProvider::OpenAI => "gpt-4o-mini",
            TranslationProvider::Google => "gemini-1.5-flash",
            TranslationProvider::Ollama => "qwen2.5",
        }
    }

    /// Get available models for this provider
    pub fn available_models(&self) -> Vec<ModelInfo> {
        match self {
            TranslationProvider::Anthropic => vec![
                ModelInfo {
                    id: "claude-3-5-haiku-20241022".to_string(),
                    name: "Claude 3.5 Haiku".to_string(),
                    description: "Fast and affordable".to_string(),
                },
                ModelInfo {
                    id: "claude-sonnet-4-20250514".to_string(),
                    name: "Claude Sonnet 4".to_string(),
                    description: "Best quality".to_string(),
                },
            ],
            TranslationProvider::OpenAI => vec![
                ModelInfo {
                    id: "gpt-4o-mini".to_string(),
                    name: "GPT-4o Mini".to_string(),
                    description: "Best price/performance".to_string(),
                },
                ModelInfo {
                    id: "gpt-4o".to_string(),
                    name: "GPT-4o".to_string(),
                    description: "Best quality".to_string(),
                },
            ],
            TranslationProvider::Google => vec![
                ModelInfo {
                    id: "gemini-1.5-flash".to_string(),
                    name: "Gemini 1.5 Flash".to_string(),
                    description: "Fast and affordable".to_string(),
                },
                ModelInfo {
                    id: "gemini-1.5-pro".to_string(),
                    name: "Gemini 1.5 Pro".to_string(),
                    description: "Best quality".to_string(),
                },
            ],
            TranslationProvider::Ollama => vec![
                ModelInfo {
                    id: "qwen2.5".to_string(),
                    name: "Qwen 2.5".to_string(),
                    description: "Best for translation - excellent multilingual support".to_string(),
                },
                ModelInfo {
                    id: "llama3.2".to_string(),
                    name: "Llama 3.2".to_string(),
                    description: "Fast, good for European languages".to_string(),
                },
                ModelInfo {
                    id: "mistral".to_string(),
                    name: "Mistral".to_string(),
                    description: "Balanced quality and speed".to_string(),
                },
            ],
        }
    }

    /// Get the URL for obtaining an API key
    pub fn api_key_url(&self) -> &'static str {
        match self {
            TranslationProvider::Anthropic => "https://console.anthropic.com/settings/keys",
            TranslationProvider::OpenAI => "https://platform.openai.com/api-keys",
            TranslationProvider::Google => "https://aistudio.google.com/app/apikey",
            TranslationProvider::Ollama => "https://ollama.com/download",
        }
    }

    /// Check if this provider requires an API key
    pub fn requires_api_key(&self) -> bool {
        !matches!(self, TranslationProvider::Ollama)
    }
}

/// Information about a model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// Result of a translation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationResult {
    pub translated_text: String,
    pub source_language: String,
    pub target_language: String,
}

/// Provider-specific configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider: TranslationProvider,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub ollama_url: Option<String>, // Custom Ollama URL (defaults to localhost:11434)
}

/// Translate text using the specified provider
pub async fn translate(
    config: &ProviderConfig,
    text: &str,
    source_language: &str,
    target_language: &str,
) -> Result<TranslationResult, String> {
    if text.trim().is_empty() {
        return Err("No text to translate".to_string());
    }

    let model = config
        .model
        .clone()
        .unwrap_or_else(|| config.provider.default_model().to_string());

    match config.provider {
        TranslationProvider::Anthropic => {
            let api_key = config
                .api_key
                .as_ref()
                .ok_or("Anthropic API key not configured")?;
            anthropic::translate(text, source_language, target_language, api_key, &model).await
        }
        TranslationProvider::OpenAI => {
            let api_key = config
                .api_key
                .as_ref()
                .ok_or("OpenAI API key not configured")?;
            openai::translate(text, source_language, target_language, api_key, &model).await
        }
        TranslationProvider::Google => {
            let api_key = config
                .api_key
                .as_ref()
                .ok_or("Google API key not configured")?;
            google::translate(text, source_language, target_language, api_key, &model).await
        }
        TranslationProvider::Ollama => {
            let base_url = config
                .ollama_url
                .as_deref()
                .unwrap_or("http://localhost:11434");
            ollama::translate(text, source_language, target_language, base_url, &model).await
        }
    }
}

/// Get the full language name from a language code
pub fn get_language_name(code: &str) -> &'static str {
    match code.to_lowercase().as_str() {
        "en" => "English",
        "es" => "Spanish",
        "fr" => "French",
        "de" => "German",
        "it" => "Italian",
        "pt" => "Portuguese",
        "zh" => "Chinese",
        "ja" => "Japanese",
        "ko" => "Korean",
        "ru" => "Russian",
        "ar" => "Arabic",
        "hi" => "Hindi",
        "nl" => "Dutch",
        "pl" => "Polish",
        "sv" => "Swedish",
        "da" => "Danish",
        "no" => "Norwegian",
        "fi" => "Finnish",
        "tr" => "Turkish",
        "he" => "Hebrew",
        "th" => "Thai",
        "vi" => "Vietnamese",
        "id" => "Indonesian",
        "ms" => "Malay",
        "tl" => "Tagalog",
        "uk" => "Ukrainian",
        "cs" => "Czech",
        "el" => "Greek",
        "ro" => "Romanian",
        "hu" => "Hungarian",
        "ca" => "Catalan",
        _ => "the specified language",
    }
}

/// Build the translation prompt
pub fn build_translation_prompt(text: &str, source_language: &str, target_language: &str) -> String {
    let source_lang_name = get_language_name(source_language);
    let target_lang_name = get_language_name(target_language);

    format!(
        "Translate the following {} text to {}. \
        Only respond with the translation, nothing else. \
        Do not add any explanations, notes, or additional text. \
        Maintain the original tone and meaning as closely as possible.\n\n\
        Text to translate:\n{}",
        source_lang_name, target_lang_name, text
    )
}

// Re-export for use in the main module
pub use anthropic::check_ollama_running;
pub use ollama::list_ollama_models;
