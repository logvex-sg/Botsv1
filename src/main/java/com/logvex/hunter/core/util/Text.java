package com.logvex.hunter.core.util;

import java.util.Map;

/** Small text helpers shared by the message, chat and export systems. */
public final class Text {
    private Text() {}

    /** Replaces every {@code {key}} placeholder with the supplied value. Unknown keys are kept. */
    public static String applyPlaceholders(String template, Map<String, String> values) {
        if (template == null || template.isEmpty() || values.isEmpty()) return template;
        String result = template;
        for (Map.Entry<String, String> entry : values.entrySet()) {
            result = result.replace("{" + entry.getKey() + "}", entry.getValue() == null ? "" : entry.getValue());
        }
        return result;
    }

    /** Collects every distinct {@code {placeholder}} found in a template, in order of appearance. */
    public static java.util.List<String> placeholders(String template) {
        java.util.List<String> found = new java.util.ArrayList<>();
        if (template == null) return found;
        int i = 0;
        while (i < template.length()) {
            int open = template.indexOf('{', i);
            if (open < 0) break;
            int close = template.indexOf('}', open + 1);
            if (close < 0) break;
            String key = template.substring(open + 1, close);
            if (!key.isEmpty() && !found.contains(key)) found.add(key);
            i = close + 1;
        }
        return found;
    }

    public static String truncate(String value, int max) {
        if (value == null) return "";
        if (value.length() <= max) return value;
        return value.substring(0, Math.max(0, max - 1)) + "\u2026";
    }

    /** Renders a CSV cell, quoting when it contains a comma, quote or newline. */
    public static String csvCell(Object value) {
        String s = value == null ? "" : String.valueOf(value);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
            return '"' + s.replace("\"", "\"\"") + '"';
        }
        return s;
    }

    public static String csvRow(Object... cells) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(csvCell(cells[i]));
        }
        return sb.toString();
    }

    /** Parses a single CSV line (handles quoted cells and escaped quotes). */
    public static java.util.List<String> parseCsvLine(String line) {
        java.util.List<String> cells = new java.util.ArrayList<>();
        if (line == null) return cells;
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') {
                        cell.append('"');
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    cell.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                cells.add(cell.toString());
                cell.setLength(0);
            } else {
                cell.append(c);
            }
        }
        cells.add(cell.toString());
        return cells;
    }

    public static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    public static String trimToNull(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public static String lower(String s) {
        return s == null ? "" : s.toLowerCase(java.util.Locale.ROOT);
    }
}
