package com.logvex.hunter.core.util;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A tiny dependency-free JSON reader/writer.
 *
 * <p>Values are represented with plain Java types: {@link Map}&lt;String,Object&gt; for objects,
 * {@link List}&lt;Object&gt; for arrays, {@link String}, {@link Double}, {@link Boolean} and
 * {@code null}. The parser rejects malformed input with a {@link JsonException} instead of
 * silently returning null, so corrupt configuration files can be reported to the user.
 */
public final class Json {
    private Json() {}

    public static class JsonException extends RuntimeException {
        public JsonException(String message) {
            super(message);
        }
    }

    // ---------------------------------------------------------------- parse

    public static Object parse(String text) {
        if (text == null) throw new JsonException("input is null");
        Parser parser = new Parser(text);
        parser.skipWhitespace();
        Object value = parser.readValue();
        parser.skipWhitespace();
        if (!parser.atEnd()) throw new JsonException("unexpected trailing content at index " + parser.index);
        return value;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String text) {
        Object value = parse(text);
        if (!(value instanceof Map)) throw new JsonException("expected a JSON object");
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> parseArray(String text) {
        Object value = parse(text);
        if (!(value instanceof List)) throw new JsonException("expected a JSON array");
        return (List<Object>) value;
    }

    // ---------------------------------------------------------------- write

    public static String write(Object value) {
        StringBuilder out = new StringBuilder();
        writeValue(value, out, -1, 0);
        return out.toString();
    }

    public static String writePretty(Object value) {
        StringBuilder out = new StringBuilder();
        writeValue(value, out, 2, 0);
        return out.toString();
    }

    private static void writeValue(Object value, StringBuilder out, int indent, int depth) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String s) {
            writeString(s, out);
        } else if (value instanceof Boolean b) {
            out.append(b.booleanValue());
        } else if (value instanceof Number n) {
            writeNumber(n, out);
        } else if (value instanceof Map<?, ?> map) {
            writeObject(map, out, indent, depth);
        } else if (value instanceof Iterable<?> list) {
            writeArray(list, out, indent, depth);
        } else if (value instanceof Object[] array) {
            List<Object> list = new ArrayList<>(array.length);
            for (Object o : array) list.add(o);
            writeArray(list, out, indent, depth);
        } else {
            writeString(String.valueOf(value), out);
        }
    }

    private static void writeNumber(Number n, StringBuilder out) {
        double d = n.doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            out.append("null");
        } else if (n instanceof Integer || n instanceof Long || n instanceof Short || n instanceof Byte) {
            out.append(n.longValue());
        } else if (d == Math.rint(d) && Math.abs(d) < 1e15) {
            out.append((long) d);
        } else {
            out.append(d);
        }
    }

    private static void writeObject(Map<?, ?> map, StringBuilder out, int indent, int depth) {
        if (map.isEmpty()) {
            out.append("{}");
            return;
        }
        out.append('{');
        boolean first = true;
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (!first) out.append(',');
            first = false;
            newline(out, indent, depth + 1);
            writeString(String.valueOf(entry.getKey()), out);
            out.append(':');
            if (indent >= 0) out.append(' ');
            writeValue(entry.getValue(), out, indent, depth + 1);
        }
        newline(out, indent, depth);
        out.append('}');
    }

    private static void writeArray(Iterable<?> list, StringBuilder out, int indent, int depth) {
        boolean first = true;
        boolean empty = true;
        StringBuilder body = new StringBuilder();
        for (Object o : list) {
            if (!first) body.append(',');
            first = false;
            empty = false;
            newline(body, indent, depth + 1);
            writeValue(o, body, indent, depth + 1);
        }
        if (empty) {
            out.append("[]");
            return;
        }
        out.append('[').append(body);
        newline(out, indent, depth);
        out.append(']');
    }

    private static void newline(StringBuilder out, int indent, int depth) {
        if (indent < 0) return;
        out.append('\n');
        out.append(" ".repeat(indent * depth));
    }

    private static void writeString(String s, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        out.append('"');
    }

    // ------------------------------------------------------------- accessors

    public static String getString(Map<String, Object> map, String key, String fallback) {
        Object value = map.get(key);
        return value instanceof String s ? s : fallback;
    }

    public static long getLong(Map<String, Object> map, String key, long fallback) {
        Object value = map.get(key);
        if (value instanceof Number n) return n.longValue();
        if (value instanceof String s) {
            try {
                return Long.parseLong(s.trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    public static int getInt(Map<String, Object> map, String key, int fallback) {
        return (int) getLong(map, key, fallback);
    }

    public static double getDouble(Map<String, Object> map, String key, double fallback) {
        Object value = map.get(key);
        if (value instanceof Number n) return n.doubleValue();
        if (value instanceof String s) {
            try {
                return Double.parseDouble(s.trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    public static boolean getBoolean(Map<String, Object> map, String key, boolean fallback) {
        Object value = map.get(key);
        if (value instanceof Boolean b) return b;
        if (value instanceof String s) return Boolean.parseBoolean(s);
        return fallback;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> getObject(Map<String, Object> map, String key) {
        Object value = map.get(key);
        return value instanceof Map ? (Map<String, Object>) value : new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    public static List<Object> getArray(Map<String, Object> map, String key) {
        Object value = map.get(key);
        return value instanceof List ? (List<Object>) value : new ArrayList<>();
    }

    public static Map<String, Object> object() {
        return new LinkedHashMap<>();
    }

    // ---------------------------------------------------------------- parser

    private static final class Parser {
        private final String text;
        private int index;

        Parser(String text) {
            this.text = text;
        }

        boolean atEnd() {
            return index >= text.length();
        }

        void skipWhitespace() {
            while (index < text.length()) {
                char c = text.charAt(index);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') index++;
                else break;
            }
        }

        private char peek() {
            if (atEnd()) throw new JsonException("unexpected end of input");
            return text.charAt(index);
        }

        private char next() {
            char c = peek();
            index++;
            return c;
        }

        Object readValue() {
            char c = peek();
            return switch (c) {
                case '{' -> readObject();
                case '[' -> readArray();
                case '"' -> readString();
                case 't', 'f' -> readBoolean();
                case 'n' -> readNull();
                default -> readNumber();
            };
        }

        Map<String, Object> readObject() {
            expect('{');
            Map<String, Object> map = new LinkedHashMap<>();
            skipWhitespace();
            if (peek() == '}') {
                index++;
                return map;
            }
            while (true) {
                skipWhitespace();
                String key = readString();
                skipWhitespace();
                expect(':');
                skipWhitespace();
                map.put(key, readValue());
                skipWhitespace();
                char c = next();
                if (c == ',') continue;
                if (c == '}') break;
                throw new JsonException("expected ',' or '}' at index " + (index - 1));
            }
            return map;
        }

        List<Object> readArray() {
            expect('[');
            List<Object> list = new ArrayList<>();
            skipWhitespace();
            if (peek() == ']') {
                index++;
                return list;
            }
            while (true) {
                skipWhitespace();
                list.add(readValue());
                skipWhitespace();
                char c = next();
                if (c == ',') continue;
                if (c == ']') break;
                throw new JsonException("expected ',' or ']' at index " + (index - 1));
            }
            return list;
        }

        String readString() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                char c = next();
                if (c == '"') break;
                if (c == '\\') {
                    char esc = next();
                    switch (esc) {
                        case '"' -> sb.append('"');
                        case '\\' -> sb.append('\\');
                        case '/' -> sb.append('/');
                        case 'n' -> sb.append('\n');
                        case 'r' -> sb.append('\r');
                        case 't' -> sb.append('\t');
                        case 'b' -> sb.append('\b');
                        case 'f' -> sb.append('\f');
                        case 'u' -> {
                            if (index + 4 > text.length()) throw new JsonException("truncated unicode escape");
                            String hex = text.substring(index, index + 4);
                            index += 4;
                            try {
                                sb.append((char) Integer.parseInt(hex, 16));
                            } catch (NumberFormatException e) {
                                throw new JsonException("invalid unicode escape \\u" + hex);
                            }
                        }
                        default -> throw new JsonException("invalid escape \\" + esc);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        Boolean readBoolean() {
            if (text.startsWith("true", index)) {
                index += 4;
                return Boolean.TRUE;
            }
            if (text.startsWith("false", index)) {
                index += 5;
                return Boolean.FALSE;
            }
            throw new JsonException("invalid literal at index " + index);
        }

        Object readNull() {
            if (text.startsWith("null", index)) {
                index += 4;
                return null;
            }
            throw new JsonException("invalid literal at index " + index);
        }

        Double readNumber() {
            int start = index;
            if (!atEnd() && (peek() == '-' || peek() == '+')) index++;
            while (!atEnd()) {
                char c = peek();
                if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') index++;
                else break;
            }
            if (start == index) throw new JsonException("expected a value at index " + index);
            try {
                return Double.parseDouble(text.substring(start, index));
            } catch (NumberFormatException e) {
                throw new JsonException("invalid number at index " + start);
            }
        }

        void expect(char expected) {
            char c = next();
            if (c != expected) throw new JsonException("expected '" + expected + "' at index " + (index - 1));
        }
    }
}
