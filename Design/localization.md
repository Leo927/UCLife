# Localization

- **Player-facing language: zh-CN.** Source-of-truth strings authored in Chinese.
- **i18n hooks present from day 1** so future translation is a translation job, not a refactor.
- **Library**: LinguiJS — compile-time extraction (no missing keys at ship), 10.4 KB.
- **Source language config**: `zh-CN`. English (and others) become target locales later.
- **Dev artifacts in English**: code, comments, this document, inspector UI, console logs, error messages.
- **Fonts**: system stack `"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif`. One brand font subsetted to GB2312 second-tier (~6,500 chars) via glyphhanger.
- **Canvas text**: `wrap='char'` for CJK line-breaking, offscreen-cached for static labels, lazy-rendered for dynamic.

## Related

- [architecture.md](architecture.md) — LinguiJS slot in the tech stack
