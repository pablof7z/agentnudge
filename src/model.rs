use serde::{Deserialize, Serialize};
use url::Url;

pub const MAX_MESSAGE_CHARS: usize = 10_000;
pub const MAX_SCREENSHOT_BYTES: usize = 10 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSubmission {
    pub session_id: String,
    pub message: String,
    pub page: PageContext,
    pub selection: Option<Selection>,
    pub arrow: Option<Arrow>,
    pub screenshot_data_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageContext {
    pub url: String,
    pub title: String,
    pub viewport: Viewport,
    pub device_pixel_ratio: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
    pub scroll_x: f64,
    pub scroll_y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub kind: SelectionKind,
    pub rect: Rect,
    pub element: Option<ElementContext>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionKind {
    Element,
    Region,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementContext {
    pub tag: String,
    pub id: Option<String>,
    pub classes: Vec<String>,
    pub role: Option<String>,
    pub accessible_name: Option<String>,
    pub text: Option<String>,
    pub selector: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Arrow {
    pub start: Point,
    pub end: Point,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackManifest {
    pub version: u8,
    pub received_at_unix_ms: u128,
    pub session_id: String,
    pub message: String,
    pub page: PageContext,
    pub selection: Option<Selection>,
    pub arrow: Option<Arrow>,
    pub screenshot_path: String,
    pub trust: TrustBoundary,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustBoundary {
    pub page_content: &'static str,
    pub note: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackReceipt {
    pub version: u8,
    pub status: &'static str,
    pub message: String,
    pub page_url: String,
    pub selection_summary: Option<String>,
    pub arrow_summary: Option<String>,
    pub manifest_path: String,
    pub screenshot_path: String,
}

impl FeedbackSubmission {
    pub fn validate_and_sanitize(mut self, expected_session: &str) -> Result<Self, String> {
        if self.session_id != expected_session {
            return Err("the feedback session does not match the waiting CLI".into());
        }

        self.message = self.message.trim().to_string();
        if self.message.is_empty() {
            return Err("feedback needs a message".into());
        }
        if self.message.chars().count() > MAX_MESSAGE_CHARS {
            return Err(format!(
                "feedback exceeds the {MAX_MESSAGE_CHARS}-character limit"
            ));
        }

        let mut page_url = Url::parse(&self.page.url)
            .map_err(|_| "the page URL is not a valid absolute URL".to_string())?;
        if !matches!(page_url.scheme(), "http" | "https") {
            return Err("the page URL must use http or https".into());
        }
        page_url.set_query(None);
        page_url.set_fragment(None);
        self.page.url = page_url.to_string();
        self.page.title = truncate(&self.page.title, 300);

        validate_viewport(&self.page.viewport)?;
        if !self.page.device_pixel_ratio.is_finite()
            || !(0.1..=10.0).contains(&self.page.device_pixel_ratio)
        {
            return Err("the device pixel ratio is outside the supported range".into());
        }

        if let Some(selection) = &mut self.selection {
            validate_rect(&selection.rect)?;
            if let Some(element) = &mut selection.element {
                element.tag = truncate(&element.tag.to_ascii_lowercase(), 80);
                element.id = element.id.take().map(|value| truncate(&value, 200));
                element.classes = element
                    .classes
                    .iter()
                    .take(20)
                    .map(|value| truncate(value, 120))
                    .collect();
                element.role = element.role.take().map(|value| truncate(&value, 120));
                element.accessible_name = element
                    .accessible_name
                    .take()
                    .map(|value| truncate(&value, 300));
                element.text = element.text.take().map(|value| truncate(&value, 500));
                element.selector = truncate(&element.selector, 1_000);
            }
        }

        if let Some(arrow) = &self.arrow {
            validate_point(&arrow.start)?;
            validate_point(&arrow.end)?;
        }

        if !self
            .screenshot_data_url
            .starts_with("data:image/png;base64,")
        {
            return Err("the screenshot must be a PNG data URL".into());
        }

        Ok(self)
    }
}

impl Selection {
    pub fn summary(&self) -> String {
        match (&self.kind, &self.element) {
            (SelectionKind::Element, Some(element)) => {
                let name = element
                    .accessible_name
                    .as_deref()
                    .or(element.text.as_deref())
                    .filter(|value| !value.is_empty());
                match name {
                    Some(name) => format!("{} \"{}\" ({})", element.tag, name, element.selector),
                    None => format!("{} ({})", element.tag, element.selector),
                }
            }
            (SelectionKind::Element, None) => "element".into(),
            (SelectionKind::Region, _) => format!(
                "region x={:.0} y={:.0} width={:.0} height={:.0}",
                self.rect.x, self.rect.y, self.rect.width, self.rect.height
            ),
        }
    }
}

impl Arrow {
    pub fn summary(&self) -> String {
        format!(
            "from ({:.0}, {:.0}) to ({:.0}, {:.0})",
            self.start.x, self.start.y, self.end.x, self.end.y
        )
    }
}

fn validate_viewport(viewport: &Viewport) -> Result<(), String> {
    for value in [
        viewport.width,
        viewport.height,
        viewport.scroll_x,
        viewport.scroll_y,
    ] {
        if !value.is_finite() || value.abs() > 1_000_000.0 {
            return Err("the viewport contains an invalid coordinate".into());
        }
    }
    if viewport.width <= 0.0 || viewport.height <= 0.0 {
        return Err("the viewport dimensions must be positive".into());
    }
    Ok(())
}

fn validate_rect(rect: &Rect) -> Result<(), String> {
    for value in [rect.x, rect.y, rect.width, rect.height] {
        if !value.is_finite() || value.abs() > 1_000_000.0 {
            return Err("the selection contains an invalid coordinate".into());
        }
    }
    if rect.width <= 0.0 || rect.height <= 0.0 {
        return Err("the selection must have positive dimensions".into());
    }
    Ok(())
}

fn validate_point(point: &Point) -> Result<(), String> {
    if !point.x.is_finite()
        || !point.y.is_finite()
        || point.x.abs() > 1_000_000.0
        || point.y.abs() > 1_000_000.0
    {
        return Err("the arrow contains an invalid coordinate".into());
    }
    Ok(())
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn submission() -> FeedbackSubmission {
        FeedbackSubmission {
            session_id: "session".into(),
            message: "  Move this button  ".into(),
            page: PageContext {
                url: "http://localhost:5173/example?token=secret#section".into(),
                title: "Example".into(),
                viewport: Viewport {
                    width: 1_200.0,
                    height: 800.0,
                    scroll_x: 0.0,
                    scroll_y: 100.0,
                },
                device_pixel_ratio: 2.0,
            },
            selection: None,
            arrow: None,
            screenshot_data_url: "data:image/png;base64,iVBORw0KGgo=".into(),
        }
    }

    #[test]
    fn sanitizes_message_and_url() {
        let value = submission().validate_and_sanitize("session").unwrap();
        assert_eq!(value.message, "Move this button");
        assert_eq!(value.page.url, "http://localhost:5173/example");
    }

    #[test]
    fn rejects_a_different_session() {
        let error = submission().validate_and_sanitize("other").unwrap_err();
        assert!(error.contains("does not match"));
    }

    #[test]
    fn rejects_empty_feedback() {
        let mut value = submission();
        value.message = "  ".into();
        assert!(value.validate_and_sanitize("session").is_err());
    }
}
