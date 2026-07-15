use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub type LogStore = Arc<Mutex<Vec<LogEntry>>>;

#[derive(Clone, Serialize)]
pub struct LogEntry {
    pub at: String,
    pub level: String,
    pub category: String,
    pub line: String,
}

pub struct LogsExportDocument {
    pub content: String,
    pub categories: HashMap<String, usize>,
}

pub fn logs_export_document(
    items: &[LogEntry],
    generated_at: &str,
    sanitizer: fn(&str) -> String,
) -> LogsExportDocument {
    let mut categories: HashMap<String, usize> = HashMap::new();
    for entry in items {
        *categories.entry(entry.category.clone()).or_insert(0) += 1;
    }
    let mut category_lines = categories
        .iter()
        .map(|(category, count)| format!("- {category}: {count}"))
        .collect::<Vec<_>>();
    category_lines.sort();
    let header = format!(
        "Aegos Logs Export\nGenerated: {generated_at}\nEntries: {}\nRedaction: subscription URLs, tokens, UUIDs, passwords, local paths, and sensitive IPs are masked before export.\nCategories:\n{}\n\n",
        items.len(),
        if category_lines.is_empty() {
            "- none".to_string()
        } else {
            category_lines.join("\n")
        }
    );
    let content = if items.is_empty() {
        format!("{header}No Aegos logs captured yet.\n")
    } else {
        header
            + &items
                .iter()
                .map(|entry| {
                    let line = sanitizer(&entry.line).replace('\r', " ").replace('\n', " ");
                    format!("{} [{}:{}] {}", entry.at, entry.level, entry.category, line)
                })
                .collect::<Vec<_>>()
                .join("\n")
            + "\n"
    };
    LogsExportDocument {
        content,
        categories,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_sanitizer(value: &str) -> String {
        value.replace("secret", "[redacted]")
    }

    #[test]
    fn log_export_document_counts_categories_and_sanitizes_lines() {
        let items = vec![
            LogEntry {
                at: "now".to_string(),
                level: "info".to_string(),
                category: "core".to_string(),
                line: "core secret line".to_string(),
            },
            LogEntry {
                at: "now".to_string(),
                level: "warn".to_string(),
                category: "diagnostic".to_string(),
                line: "plain".to_string(),
            },
        ];

        let document = logs_export_document(&items, "generated", test_sanitizer);
        assert_eq!(document.categories.get("core"), Some(&1));
        assert_eq!(document.categories.get("diagnostic"), Some(&1));
        assert!(document.content.contains("[redacted]"));
        assert!(!document.content.contains("secret line"));
    }
}
