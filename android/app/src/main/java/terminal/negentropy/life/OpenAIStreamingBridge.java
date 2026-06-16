package terminal.negentropy.life;

import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import okhttp3.sse.EventSources;

public final class OpenAIStreamingBridge {

    private static final String TAG = "OpenAIStreamingBridge";
    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build();
    private static final Map<String, EventSource> ACTIVE_STREAMS = new ConcurrentHashMap<>();

    private OpenAIStreamingBridge() {}

    public static void startStreamingChat(WebView webView, String requestId, String requestJson) throws Exception {
        cancelStreamingChat(requestId);

        JSONObject payload = new JSONObject(requestJson);
        String url = payload.getString("url");
        String body = payload.getString("body");
        JSONObject headersJson = payload.optJSONObject("headers");

        Headers.Builder headersBuilder = new Headers.Builder();
        if (headersJson != null) {
            Iterator<String> keys = headersJson.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                headersBuilder.set(key, headersJson.optString(key, ""));
            }
        }

        Request request = new Request.Builder()
                .url(url)
                .headers(headersBuilder.build())
                .post(RequestBody.create(body, JSON_MEDIA_TYPE))
                .build();

        NativeStreamListener listener = new NativeStreamListener(requestId, webView);
        EventSource eventSource = EventSources.createFactory(CLIENT).newEventSource(request, listener);
        ACTIVE_STREAMS.put(requestId, eventSource);
    }

    public static void cancelStreamingChat(String requestId) {
        EventSource eventSource = ACTIVE_STREAMS.remove(requestId);
        if (eventSource != null) {
            eventSource.cancel();
        }
    }

    public static void emitBridgeError(WebView webView, String requestId, String message) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("requestId", requestId);
            payload.put("type", "error");
            payload.put("transport", "native-openai-android");
            payload.put("error", message);
        } catch (Exception ignored) {
        }
        dispatchToWebView(new WeakReference<>(webView), payload);
    }

    private static void dispatchToWebView(WeakReference<WebView> webViewRef, JSONObject payload) {
        WebView webView = webViewRef.get();
        if (webView == null) return;

        String script = "window.dispatchEvent(new CustomEvent('native-ai-stream', { detail: JSON.parse("
                + JSONObject.quote(payload.toString())
                + ") }));";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private static final class NativeStreamListener extends EventSourceListener {
        private final String requestId;
        private final WeakReference<WebView> webViewRef;
        private final long startedAt = System.currentTimeMillis();
        private final Map<Integer, ToolAccumulator> toolAccumulators = new LinkedHashMap<>();
        private boolean sentDone = false;
        private boolean sawToolCalls = false;
        private int chunkIndex = 0;
        private String contentType = "";
        private int statusCode = 0;

        NativeStreamListener(String requestId, WebView webView) {
            this.requestId = requestId;
            this.webViewRef = new WeakReference<>(webView);
        }

        @Override
        public void onOpen(EventSource eventSource, Response response) {
            statusCode = response.code();
            contentType = response.header("Content-Type", "");

            JSONObject payload = basePayload("meta");
            try {
                payload.put("transport", "native-openai-android");
                payload.put("statusCode", statusCode);
                payload.put("contentType", contentType);
            } catch (Exception ignored) {
            }
            dispatchToWebView(webViewRef, payload);
        }

        @Override
        public void onEvent(EventSource eventSource, String id, String type, String data) {
            if (data == null) return;
            String trimmed = data.trim();
            if (trimmed.isEmpty()) return;

            if ("[DONE]".equals(trimmed)) {
                flushToolCalls();
                dispatchDone();
                cleanup();
                return;
            }

            try {
                JSONObject json = new JSONObject(trimmed);
                JSONArray choices = json.optJSONArray("choices");
                if (choices == null || choices.length() == 0) return;

                JSONObject choice = choices.optJSONObject(0);
                if (choice == null) return;

                JSONObject delta = choice.optJSONObject("delta");
                if (delta != null) {
                    String content = null;
                    if (delta.has("content") && !delta.isNull("content")) {
                        content = delta.optString("content", "");
                    }
                    // 处理思考内容 (DeepSeek V4 Pro reasoning_content delta)
                    String reasoningContent = null;
                    if (delta.has("reasoning_content") && !delta.isNull("reasoning_content")) {
                        reasoningContent = delta.optString("reasoning_content", "");
                    }
                    if (reasoningContent != null && !reasoningContent.isEmpty()) {
                        JSONObject thinkingPayload = basePayload("thinking");
                        thinkingPayload.put("thinkingText", reasoningContent);
                        dispatchToWebView(webViewRef, thinkingPayload);
                    }

                    if (content != null && !content.isEmpty() && !"null".equals(content)) {
                        chunkIndex += 1;
                        JSONObject payload = basePayload("text");
                        payload.put("text", content);
                        payload.put("chunkIndex", chunkIndex);
                        if (chunkIndex == 1) {
                            payload.put("firstChunkMs", System.currentTimeMillis() - startedAt);
                        }
                        dispatchToWebView(webViewRef, payload);
                    }

                    JSONArray toolCalls = delta.optJSONArray("tool_calls");
                    if (toolCalls != null) {
                        accumulateToolCalls(toolCalls);
                    }
                }

                if ("tool_calls".equals(choice.optString("finish_reason"))) {
                    flushToolCalls();
                }
            } catch (Exception error) {
                Log.w(TAG, "Failed to parse SSE data: " + trimmed, error);
            }
        }

        @Override
        public void onClosed(EventSource eventSource) {
            flushToolCalls();
            dispatchDone();
            cleanup();
        }

        @Override
        public void onFailure(EventSource eventSource, Throwable t, Response response) {
            // Some OpenAI-compatible backends close SSE streams in a way that OkHttp
            // reports via onFailure even after useful chunks/tool_calls have arrived.
            // If we already have partial output, prefer flushing and completing the
            // stream instead of surfacing a hard failure to the UI.
            if (!sentDone && hasRecoverableOutput()) {
                Log.w(TAG, "Recovering native stream after failure because usable content/tool calls already arrived."
                        + " requestId=" + requestId
                        + " status=" + (response != null ? response.code() : statusCode)
                        + " error=" + (t != null ? t.getMessage() : "Native stream failure"));
                flushToolCalls();
                dispatchDone();
                cleanup();
                return;
            }

            JSONObject payload = basePayload("error");
            try {
                payload.put("statusCode", response != null ? response.code() : statusCode);
                payload.put("contentType", response != null ? response.header("Content-Type", contentType) : contentType);
                payload.put("error", t != null ? t.getMessage() : "Native stream failure");
            } catch (Exception ignored) {
            }
            dispatchToWebView(webViewRef, payload);
            cleanup();
        }

        private void accumulateToolCalls(JSONArray toolCalls) {
            for (int i = 0; i < toolCalls.length(); i++) {
                JSONObject item = toolCalls.optJSONObject(i);
                if (item == null) continue;

                int index = item.optInt("index", i);
                ToolAccumulator accumulator = toolAccumulators.get(index);
                if (accumulator == null) {
                    accumulator = new ToolAccumulator();
                    toolAccumulators.put(index, accumulator);
                }

                String toolCallId = item.optString("id", "");
                if (!toolCallId.isEmpty()) {
                    accumulator.id = toolCallId;
                }

                JSONObject function = item.optJSONObject("function");
                if (function != null) {
                    String name = function.optString("name", "");
                    String arguments = function.optString("arguments", "");
                    if (!name.isEmpty()) {
                        accumulator.name = name;
                    }
                    if (!arguments.isEmpty()) {
                        accumulator.arguments.append(arguments);
                    }
                }
            }
        }

        private void flushToolCalls() {
            for (Map.Entry<Integer, ToolAccumulator> entry : toolAccumulators.entrySet()) {
                ToolAccumulator accumulator = entry.getValue();
                if (accumulator.name == null || accumulator.name.isEmpty()) continue;

                sawToolCalls = true;

                JSONObject payload = basePayload("tool_call");
                try {
                    JSONObject toolCall = new JSONObject();
                    toolCall.put("name", accumulator.name);
                    if (accumulator.id != null && !accumulator.id.isEmpty()) {
                        toolCall.put("_id", accumulator.id);
                    }
                    String rawArgs = accumulator.arguments.toString().trim();
                    if (!rawArgs.isEmpty()) {
                        try {
                            toolCall.put("args", new JSONObject(rawArgs));
                        } catch (Exception objectError) {
                            try {
                                toolCall.put("args", new JSONArray(rawArgs));
                            } catch (Exception arrayError) {
                                toolCall.put("args", new JSONObject());
                            }
                        }
                    } else {
                        toolCall.put("args", new JSONObject());
                    }
                    payload.put("toolCall", toolCall);
                } catch (Exception ignored) {
                }
                dispatchToWebView(webViewRef, payload);
            }
            toolAccumulators.clear();
        }

        private boolean hasRecoverableOutput() {
            return chunkIndex > 0 || sawToolCalls || hasCompleteToolCall();
        }

        private boolean hasCompleteToolCall() {
            for (ToolAccumulator accumulator : toolAccumulators.values()) {
                if (accumulator.name != null && !accumulator.name.trim().isEmpty()) {
                    return true;
                }
            }
            return false;
        }

        private void dispatchDone() {
            if (sentDone) return;
            sentDone = true;
            dispatchToWebView(webViewRef, basePayload("done"));
        }

        private JSONObject basePayload(String type) {
            JSONObject payload = new JSONObject();
            try {
                payload.put("requestId", requestId);
                payload.put("type", type);
                payload.put("statusCode", statusCode);
                payload.put("contentType", contentType);
            } catch (Exception ignored) {
            }
            return payload;
        }

        private void cleanup() {
            ACTIVE_STREAMS.remove(requestId);
        }
    }

    private static final class ToolAccumulator {
        String id;
        String name;
        final StringBuilder arguments = new StringBuilder();
    }
}
