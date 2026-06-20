package terminal.negentropy.life;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class EmotionHaptics {

    private static final String TAG = "EmotionHaptics";
    private static final Pattern HAPTIC_MARKER_REGEX = Pattern.compile("\\[HAPTIC:([a-z0-9_-]+)\\]", Pattern.CASE_INSENSITIVE);
    private static final Pattern HAPTIC_CUSTOM_PATTERN_REGEX = Pattern.compile("\\[HAPTIC_PATTERN\\]([\\s\\S]*?)\\[/HAPTIC_PATTERN\\]", Pattern.CASE_INSENSITIVE);
    private static final int MIN_WAVEFORM_ENTRIES = 2;
    private static final int MAX_WAVEFORM_ENTRIES = 12;
    private static final int MIN_TIMING_VALUE = 10;
    private static final int MAX_TIMING_VALUE = 400;
    private static final int MIN_TOTAL_DURATION = 80;
    private static final int MAX_TOTAL_DURATION = 1500;

    private static final Map<String, WaveformPattern> PATTERNS = new HashMap<>();
    private static final Map<String, String> ALIASES = new HashMap<>();
    private static final Map<String, Pattern> SYNTHESIS_KEYWORDS = new HashMap<>();
    private static volatile String lastError = null;

    static {
        registerPattern("warning", new long[]{0, 70, 35, 85, 35, 110}, new int[]{0, 255, 0, 232, 0, 255});
        registerPattern("alert", new long[]{0, 50, 35, 50, 35, 50}, new int[]{0, 220, 0, 240, 0, 220});
        registerPattern("panic", new long[]{0, 25, 35, 25, 25, 40, 25, 70}, new int[]{0, 190, 0, 150, 0, 210, 0, 255});
        registerPattern("anger", new long[]{0, 35, 20, 35, 20, 55, 25, 95}, new int[]{0, 210, 0, 235, 0, 255, 0, 255});
        registerPattern("comfort", new long[]{0, 80, 90, 120, 110, 160, 140, 220}, new int[]{0, 72, 0, 84, 0, 96, 0, 108});
        registerPattern("gentle", new long[]{0, 36}, new int[]{0, 64});
        registerPattern("calm", new long[]{0, 55, 120, 90, 160, 120}, new int[]{0, 62, 0, 74, 0, 84});
        registerPattern("sadness", new long[]{0, 180, 150, 220}, new int[]{0, 118, 0, 86});
        registerPattern("melancholy", new long[]{0, 120, 120, 150, 200, 210}, new int[]{0, 88, 0, 72, 0, 60});
        registerPattern("heartbeat", new long[]{0, 90, 70, 120, 260, 90, 70, 120}, new int[]{0, 160, 0, 225, 0, 160, 0, 225});
        registerPattern("affection", new long[]{0, 30, 45, 40, 180, 60, 40, 80}, new int[]{0, 110, 0, 146, 0, 170, 0, 196});
        registerPattern("longing", new long[]{0, 60, 80, 90, 110, 130}, new int[]{0, 88, 0, 110, 0, 136});
        registerPattern("excitement", new long[]{0, 25, 25, 40, 25, 65, 25, 95, 25, 140}, new int[]{0, 116, 0, 148, 0, 180, 0, 216, 0, 255});
        registerPattern("nervousness", new long[]{0, 20, 50, 35, 35, 20, 70, 45, 45, 30}, new int[]{0, 100, 0, 84, 0, 110, 0, 132, 0, 90});
        registerPattern("pride", new long[]{0, 120, 90, 150}, new int[]{0, 170, 0, 220});
        registerPattern("determination", new long[]{0, 80, 60, 120, 60, 160}, new int[]{0, 128, 0, 172, 0, 220});
        registerPattern("success", new long[]{0, 50, 70, 110}, new int[]{0, 140, 0, 220});
        registerPattern("error", new long[]{0, 85, 35, 85, 35, 85}, new int[]{0, 220, 0, 255, 0, 220});
        registerPattern("curiosity", new long[]{0, 25, 45, 45, 45, 70}, new int[]{0, 100, 0, 118, 0, 150});
        registerPattern("teasing", new long[]{0, 35, 55, 35, 105, 75}, new int[]{0, 120, 0, 120, 0, 176});

        registerAlias("affectionate", "affection");
        registerAlias("alarm", "alert");
        registerAlias("anxious", "nervousness");
        registerAlias("calmness", "calm");
        registerAlias("care", "comfort");
        registerAlias("caring", "comfort");
        registerAlias("celebrate", "success");
        registerAlias("cheerful", "success");
        registerAlias("concerned", "warning");
        registerAlias("comforting", "comfort");
        registerAlias("crush", "affection");
        registerAlias("danger", "warning");
        registerAlias("determined", "determination");
        registerAlias("fear", "panic");
        registerAlias("flirt", "teasing");
        registerAlias("flirty", "teasing");
        registerAlias("flutter", "heartbeat");
        registerAlias("grief", "melancholy");
        registerAlias("happy", "success");
        registerAlias("heart", "heartbeat");
        registerAlias("heartbeat_fast", "excitement");
        registerAlias("heartthrob", "affection");
        registerAlias("intrigued", "curiosity");
        registerAlias("joyful", "success");
        registerAlias("love", "affection");
        registerAlias("loving", "affection");
        registerAlias("mischievous", "teasing");
        registerAlias("mourn", "melancholy");
        registerAlias("panic_attack", "panic");
        registerAlias("peaceful", "calm");
        registerAlias("playful", "teasing");
        registerAlias("proud", "pride");
        registerAlias("pulse", "heartbeat");
        registerAlias("reassure", "comfort");
        registerAlias("reassuring", "gentle");
        registerAlias("romantic", "affection");
        registerAlias("sad", "sadness");
        registerAlias("scolding", "warning");
        registerAlias("shocked", "excitement");
        registerAlias("soft", "gentle");
        registerAlias("soothe", "comfort");
        registerAlias("soothing", "gentle");
        registerAlias("sorrow", "melancholy");
        registerAlias("sorrowful", "sadness");
        registerAlias("stern", "warning");
        registerAlias("surprise", "excitement");
        registerAlias("surprised", "excitement");
        registerAlias("tender", "comfort");
        registerAlias("tense", "nervousness");
        registerAlias("urgent", "warning");
        registerAlias("warm", "comfort");
        registerAlias("wow", "excitement");

        SYNTHESIS_KEYWORDS.put("warning", Pattern.compile("(warn|alert|panic|anger|danger|alarm|urgent|error|stern|scold|shock|threat)", Pattern.CASE_INSENSITIVE));
        SYNTHESIS_KEYWORDS.put("comfort", Pattern.compile("(comfort|gentle|calm|soft|warm|tender|relief|relax|safe|sooth|reassur|quiet)", Pattern.CASE_INSENSITIVE));
        SYNTHESIS_KEYWORDS.put("sadness", Pattern.compile("(sad|sorrow|grief|melan|lonely|long|miss|hurt|cry|blue|ache)", Pattern.CASE_INSENSITIVE));
        SYNTHESIS_KEYWORDS.put("heartbeat", Pattern.compile("(heart|love|affection|romance|crush|pulse|flutter|beat)", Pattern.CASE_INSENSITIVE));
        SYNTHESIS_KEYWORDS.put("teasing", Pattern.compile("(tease|play|mischief|fun|cheer|happy|excite|wow|wink|smirk)", Pattern.CASE_INSENSITIVE));
    }

    private EmotionHaptics() {}

    public static ParsedHapticText extractFromText(String text) {
        if (text == null) {
            return new ParsedHapticText("", null, null, null, null, false, null);
        }

        CueSelection lastSelection = null;
        Matcher customMatcher = HAPTIC_CUSTOM_PATTERN_REGEX.matcher(text);
        while (customMatcher.find()) {
            CueSelection candidate = parseCustomDirective(customMatcher.group(1), customMatcher.start());
            if (lastSelection == null || candidate.startIndex >= lastSelection.startIndex) {
                lastSelection = candidate;
            }
        }

        Matcher markerMatcher = HAPTIC_MARKER_REGEX.matcher(text);
        while (markerMatcher.find()) {
            CueSelection candidate = buildCueSelectionFromMarker(markerMatcher.group(1), markerMatcher.start());
            if (lastSelection == null || candidate.startIndex >= lastSelection.startIndex) {
                lastSelection = candidate;
            }
        }

        String cleanText = text
                .replaceAll("(?is)\\[HAPTIC_PATTERN\\][\\s\\S]*?\\[/HAPTIC_PATTERN\\]", "")
                .replaceAll("(?i)\\[HAPTIC:[^\\]]*\\]", "")  // 匹配 [HAPTIC:任意内容]，包括中文逗号等
                .replaceAll("(?i)\\[\\/?HAPTIC_PATTERN\\]", "")
                .replaceAll("\\n{3,}", "\n\n")
                .trim();

        if (lastSelection == null) {
            return new ParsedHapticText(cleanText, null, null, null, null, false, null);
        }

        return new ParsedHapticText(
                cleanText,
                lastSelection.emotion,
                lastSelection.rawEmotion,
                lastSelection.cueType,
                lastSelection.patternJson,
                true,
                lastSelection.parseError
        );
    }

    public static void playParsedCue(Context context, ParsedHapticText parsedText) {
        if (parsedText == null) return;
        if (parsedText.patternJson != null && !parsedText.patternJson.isEmpty()) {
            playPatternJson(context, parsedText.patternJson);
            return;
        }
        if (parsedText.emotion != null) {
            playEmotion(context, parsedText.emotion);
        }
    }

    public static void playEmotion(Context context, String emotion) {
        String resolvedEmotion = resolveEmotion(emotion);
        if (resolvedEmotion == null) {
            lastError = "Unknown emotion ignored: " + emotion;
            Log.w(TAG, lastError);
            return;
        }
        playPattern(context, PATTERNS.get(resolvedEmotion));
    }

    public static void playPatternJson(Context context, String patternJson) {
        if (patternJson == null || patternJson.trim().isEmpty()) return;

        try {
            JSONObject pattern = new JSONObject(patternJson);
            String label = pattern.optString("label", "custom");
            long[] timings = jsonArrayToLongArray(pattern.optJSONArray("timings"));
            int[] amplitudes = jsonArrayToIntArray(pattern.optJSONArray("amplitudes"));
            WaveformValidationResult validated = validateWaveform(label, timings, amplitudes);
            if (!validated.valid || validated.pattern == null) {
                lastError = validated.error;
                Log.w(TAG, validated.error);
                return;
            }
            playPattern(context, validated.pattern);
        } catch (Exception error) {
            Log.e(TAG, "Failed to play custom haptic pattern", error);
            lastError = error.getMessage();
        }
    }

    public static void cancel(Context context) {
        Vibrator vibrator = getVibrator(context);
        if (vibrator != null && vibrator.hasVibrator()) {
            vibrator.cancel();
            lastError = null;
        }
    }

    public static boolean hasVibrator(Context context) {
        Vibrator vibrator = getVibrator(context);
        return vibrator != null && vibrator.hasVibrator();
    }

    public static String getLastError() {
        return lastError;
    }

    public static String resolveEmotion(String emotion) {
        if (emotion == null) return null;

        String normalized = normalizeEmotion(emotion);
        if (PATTERNS.containsKey(normalized)) {
            return normalized;
        }

        String compact = normalized.replace("_", "");
        if (PATTERNS.containsKey(compact)) {
            return compact;
        }

        String alias = ALIASES.get(normalized);
        if (alias != null && PATTERNS.containsKey(alias)) {
            return alias;
        }

        alias = ALIASES.get(compact);
        if (alias != null && PATTERNS.containsKey(alias)) {
            return alias;
        }

        return null;
    }

    private static CueSelection buildCueSelectionFromMarker(String rawEmotion, int startIndex) {
        String resolvedEmotion = resolveEmotion(rawEmotion);
        if (resolvedEmotion != null) {
            return new CueSelection(startIndex, rawEmotion, resolvedEmotion, "canonical", null, null);
        }

        SynthesizedCue synthesizedCue = synthesizePattern(rawEmotion);
        return new CueSelection(
                startIndex,
                rawEmotion,
                synthesizedCue.family,
                "synthesized",
                waveformToJson(rawEmotion, synthesizedCue.pattern),
                null
        );
    }

    private static CueSelection parseCustomDirective(String rawJson, int startIndex) {
        try {
            JSONObject parsed = new JSONObject(rawJson);
            String rawLabel = parsed.optString("label", "").trim();
            if (rawLabel.isEmpty()) {
                return new CueSelection(startIndex, null, null, null, null, "Custom haptic pattern is missing a label.");
            }

            long[] timings = jsonArrayToLongArray(parsed.optJSONArray("timings"));
            int[] amplitudes = jsonArrayToIntArray(parsed.optJSONArray("amplitudes"));
            WaveformValidationResult validated = validateWaveform(rawLabel, timings, amplitudes);
            if (validated.valid && validated.pattern != null) {
                return new CueSelection(
                        startIndex,
                        rawLabel,
                        rawLabel,
                        "custom",
                        waveformToJson(rawLabel, validated.pattern),
                        null
                );
            }

            SynthesizedCue synthesizedCue = synthesizePattern(rawLabel);
            return new CueSelection(
                    startIndex,
                    rawLabel,
                    synthesizedCue.family,
                    "synthesized",
                    waveformToJson(rawLabel, synthesizedCue.pattern),
                    validated.error
            );
        } catch (Exception error) {
            return new CueSelection(
                    startIndex,
                    null,
                    null,
                    null,
                    null,
                    "Failed to parse custom haptic JSON: " + (error.getMessage() != null ? error.getMessage() : String.valueOf(error))
            );
        }
    }

    private static WaveformValidationResult validateWaveform(String label, long[] rawTimings, int[] rawAmplitudes) {
        if (rawTimings == null || rawAmplitudes == null || rawTimings.length == 0 || rawAmplitudes.length == 0) {
            return WaveformValidationResult.invalid("Custom haptic pattern requires non-empty timings and amplitudes.");
        }

        long[] timings = rawTimings;
        int[] amplitudes = rawAmplitudes;
        if (timings[0] != 0) {
            timings = prependZero(timings);
            amplitudes = prependZero(amplitudes);
        }

        if (timings.length != amplitudes.length) {
            return WaveformValidationResult.invalid("Custom haptic pattern timings/amplitudes length mismatch.");
        }

        if (timings.length < MIN_WAVEFORM_ENTRIES || timings.length > MAX_WAVEFORM_ENTRIES) {
            return WaveformValidationResult.invalid("Custom haptic pattern entry count is out of bounds.");
        }

        long totalDuration = 0L;
        for (int i = 0; i < timings.length; i++) {
            totalDuration += timings[i];
            if (i == 0) {
                if (timings[i] != 0 || amplitudes[i] != 0) {
                    return WaveformValidationResult.invalid("Custom haptic pattern must start with 0 timing and 0 amplitude.");
                }
                continue;
            }
            if (timings[i] < MIN_TIMING_VALUE || timings[i] > MAX_TIMING_VALUE) {
                return WaveformValidationResult.invalid("Custom haptic timing is out of bounds.");
            }
        }

        if (totalDuration < MIN_TOTAL_DURATION || totalDuration > MAX_TOTAL_DURATION) {
            return WaveformValidationResult.invalid("Custom haptic pattern total duration is out of bounds.");
        }

        int[] normalizedAmplitudes = new int[amplitudes.length];
        for (int i = 0; i < amplitudes.length; i++) {
            if (i == 0 || i % 2 == 0) {
                normalizedAmplitudes[i] = 0;
            } else {
                normalizedAmplitudes[i] = clamp(amplitudes[i], 1, 255);
            }
        }

        return WaveformValidationResult.valid(new WaveformPattern(timings, normalizedAmplitudes, -1, label));
    }

    private static SynthesizedCue synthesizePattern(String label) {
        String normalizedLabel = normalizeEmotion(label);
        String family = inferSynthesisFamily(normalizedLabel);
        int hash = fnv1aHash(normalizedLabel);

        long[] baseTimings;
        int[] baseAmplitudes;
        switch (family) {
            case "warning":
                baseTimings = new long[]{0, 45, 28, 70, 24, 110};
                baseAmplitudes = new int[]{0, 220, 0, 208, 0, 255};
                break;
            case "comfort":
                baseTimings = new long[]{0, 78, 90, 116, 132, 164};
                baseAmplitudes = new int[]{0, 88, 0, 102, 0, 118};
                break;
            case "sadness":
                baseTimings = new long[]{0, 120, 110, 176};
                baseAmplitudes = new int[]{0, 118, 0, 88};
                break;
            case "heartbeat":
                baseTimings = new long[]{0, 72, 64, 112, 220, 72, 64, 112};
                baseAmplitudes = new int[]{0, 148, 0, 214, 0, 148, 0, 214};
                break;
            default:
                baseTimings = new long[]{0, 32, 38, 44, 92, 72};
                baseAmplitudes = new int[]{0, 118, 0, 140, 0, 186};
                break;
        }

        long[] timings = new long[baseTimings.length];
        int[] amplitudes = new int[baseAmplitudes.length];
        for (int i = 0; i < baseTimings.length; i++) {
            if (i == 0) {
                timings[i] = 0;
            } else {
                int bias = ((hash >>> ((i * 3) % 24)) & 0x1f) - 10;
                timings[i] = clamp(baseTimings[i] + bias, MIN_TIMING_VALUE, MAX_TIMING_VALUE);
            }
        }
        for (int i = 0; i < baseAmplitudes.length; i++) {
            if (i == 0 || baseAmplitudes[i] == 0) {
                amplitudes[i] = 0;
            } else {
                int bias = ((hash >>> ((i * 5 + 7) % 24)) & 0x3f) - 20;
                amplitudes[i] = clamp(baseAmplitudes[i] + bias, 48, 255);
            }
        }

        WaveformValidationResult validated = validateWaveform(normalizedLabel, timings, amplitudes);
        if (validated.valid && validated.pattern != null) {
            return new SynthesizedCue(family, validated.pattern);
        }

        WaveformPattern fallback = PATTERNS.get(family);
        return new SynthesizedCue(family, fallback != null ? fallback : PATTERNS.get("gentle"));
    }

    private static String inferSynthesisFamily(String label) {
        for (Map.Entry<String, Pattern> entry : SYNTHESIS_KEYWORDS.entrySet()) {
            if (entry.getValue().matcher(label).find()) {
                return entry.getKey();
            }
        }
        String[] families = new String[]{"warning", "comfort", "sadness", "heartbeat", "teasing"};
        return families[Math.floorMod(fnv1aHash(label), families.length)];
    }

    private static String waveformToJson(String label, WaveformPattern pattern) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("label", label);
            payload.put("repeat", -1);
            JSONArray timings = new JSONArray();
            JSONArray amplitudes = new JSONArray();
            for (long value : pattern.timings) {
                timings.put(value);
            }
            for (int value : pattern.amplitudes) {
                amplitudes.put(value);
            }
            payload.put("timings", timings);
            payload.put("amplitudes", amplitudes);
            return payload.toString();
        } catch (Exception error) {
            lastError = error.getMessage();
            Log.e(TAG, "Failed to build haptic waveform JSON", error);
            return null;
        }
    }

    private static void playPattern(Context context, WaveformPattern pattern) {
        if (pattern == null) return;

        Vibrator vibrator = getVibrator(context);
        if (vibrator == null || !vibrator.hasVibrator()) {
            lastError = "No vibrator available";
            return;
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                VibrationEffect effect;
                if (pattern.amplitudes.length == pattern.timings.length) {
                    effect = VibrationEffect.createWaveform(pattern.timings, pattern.amplitudes, pattern.repeat);
                } else {
                    effect = VibrationEffect.createWaveform(pattern.timings, pattern.repeat);
                }
                vibrator.vibrate(effect);
            } else {
                vibrator.vibrate(pattern.timings, pattern.repeat);
            }
            lastError = null;
        } catch (Exception error) {
            Log.e(TAG, "Failed to vibrate with emotion pattern", error);
            lastError = error.getMessage();
        }
    }

    private static Vibrator getVibrator(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = context.getSystemService(VibratorManager.class);
            return manager != null ? manager.getDefaultVibrator() : null;
        }
        return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    private static void registerPattern(String key, long[] timings, int[] amplitudes) {
        PATTERNS.put(key, new WaveformPattern(timings, amplitudes, -1, key));
    }

    private static void registerAlias(String alias, String canonical) {
        ALIASES.put(alias, canonical);
    }

    private static String normalizeEmotion(String emotion) {
        return emotion == null ? "" : emotion.trim().toLowerCase(Locale.US).replaceAll("[\\s-]+", "_");
    }

    private static int fnv1aHash(String label) {
        int hash = 0x811c9dc5;
        for (int i = 0; i < label.length(); i++) {
            hash ^= label.charAt(i);
            hash *= 0x01000193;
        }
        return hash;
    }

    private static long[] prependZero(long[] source) {
        long[] result = new long[source.length + 1];
        result[0] = 0L;
        System.arraycopy(source, 0, result, 1, source.length);
        return result;
    }

    private static int[] prependZero(int[] source) {
        int[] result = new int[source.length + 1];
        result[0] = 0;
        System.arraycopy(source, 0, result, 1, source.length);
        return result;
    }

    private static long[] jsonArrayToLongArray(JSONArray array) {
        if (array == null) return new long[0];
        long[] result = new long[array.length()];
        for (int i = 0; i < array.length(); i++) {
            result[i] = Math.round(array.optDouble(i, 0));
        }
        return result;
    }

    private static int[] jsonArrayToIntArray(JSONArray array) {
        if (array == null) return new int[0];
        int[] result = new int[array.length()];
        for (int i = 0; i < array.length(); i++) {
            result[i] = (int) Math.round(array.optDouble(i, 0));
        }
        return result;
    }

    private static int clamp(long value, int min, int max) {
        return (int) Math.max(min, Math.min(max, value));
    }

    public static final class ParsedHapticText {
        public final String cleanText;
        public final String emotion;
        public final String rawEmotion;
        public final String cueType;
        public final String patternJson;
        public final boolean markerDetected;
        public final String parseError;

        ParsedHapticText(
                String cleanText,
                String emotion,
                String rawEmotion,
                String cueType,
                String patternJson,
                boolean markerDetected,
                String parseError
        ) {
            this.cleanText = cleanText;
            this.emotion = emotion;
            this.rawEmotion = rawEmotion;
            this.cueType = cueType;
            this.patternJson = patternJson;
            this.markerDetected = markerDetected;
            this.parseError = parseError;
        }
    }

    private static final class CueSelection {
        final int startIndex;
        final String rawEmotion;
        final String emotion;
        final String cueType;
        final String patternJson;
        final String parseError;

        CueSelection(int startIndex, String rawEmotion, String emotion, String cueType, String patternJson, String parseError) {
            this.startIndex = startIndex;
            this.rawEmotion = rawEmotion;
            this.emotion = emotion;
            this.cueType = cueType;
            this.patternJson = patternJson;
            this.parseError = parseError;
        }
    }

    private static final class SynthesizedCue {
        final String family;
        final WaveformPattern pattern;

        SynthesizedCue(String family, WaveformPattern pattern) {
            this.family = family;
            this.pattern = pattern;
        }
    }

    private static final class WaveformValidationResult {
        final boolean valid;
        final WaveformPattern pattern;
        final String error;

        private WaveformValidationResult(boolean valid, WaveformPattern pattern, String error) {
            this.valid = valid;
            this.pattern = pattern;
            this.error = error;
        }

        static WaveformValidationResult valid(WaveformPattern pattern) {
            return new WaveformValidationResult(true, pattern, null);
        }

        static WaveformValidationResult invalid(String error) {
            return new WaveformValidationResult(false, null, error);
        }
    }

    private static final class WaveformPattern {
        final long[] timings;
        final int[] amplitudes;
        final int repeat;
        final String label;

        WaveformPattern(long[] timings, int[] amplitudes, int repeat, String label) {
            this.timings = timings;
            this.amplitudes = amplitudes;
            this.repeat = repeat;
            this.label = label;
        }
    }
}
