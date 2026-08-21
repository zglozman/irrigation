"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface StreamEvent {
  type: "text" | "tool" | "done" | "error";
  delta?: string;
  name?: string;
  label?: string;
  message?: string;
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [toolsRunning, setToolsRunning] = useState<Map<string, string>>(new Map());
  const [chatError, setChatError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, toolsRunning]);

  // Cancel any in-flight stream when the panel closes or the widget unmounts.
  useEffect(() => {
    if (!isOpen) abortRef.current?.abort();
    return () => abortRef.current?.abort();
  }, [isOpen]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = { role: "user", content: text };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setStreamingContent("");
    setToolsRunning(new Map());
    setChatError("");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
        signal: abort.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      let assistantContent = "";
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines[lines.length - 1];

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          if (line.startsWith("data: ")) {
            try {
              const event: StreamEvent = JSON.parse(line.slice(6));

              if (event.type === "text" && event.delta) {
                assistantContent += event.delta;
                setStreamingContent(assistantContent);
              } else if (event.type === "tool" && event.name && event.label) {
                const name = event.name;
                const label = event.label;
                setToolsRunning((prev) => {
                  const next = new Map(prev);
                  next.set(name, label);
                  return next;
                });
              } else if (event.type === "done") {
                if (assistantContent) {
                  setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: assistantContent },
                  ]);
                  setStreamingContent("");
                }
                setToolsRunning(new Map());
              } else if (event.type === "error") {
                setChatError(event.message || "Something went wrong");
                // Keep whatever partial answer streamed before the error.
                if (assistantContent) {
                  setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: assistantContent },
                  ]);
                  setStreamingContent("");
                }
              }
            } catch (e) {
              console.error("Failed to parse event:", e);
            }
          }
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Chat error:", error);
        setChatError("Couldn't reach Sprout — please try again");
      }
    } finally {
      setIsLoading(false);
      setToolsRunning(new Map());
    }
  };

  const suggestions = [
    "Why didn't zone 3 water today?",
    "How's the week's water budget?",
    "Run the tomatoes for 10 minutes",
  ];

  const isEmpty = messages.length === 0 && !streamingContent;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-40 group"
        aria-label="Open Sprout chat"
      >
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 bg-teal-500 rounded-full flex items-center justify-center text-2xl shadow-lg group-hover:shadow-xl transition-shadow animate-pulse">
            🌱
          </div>
          <div className="absolute inset-0 bg-teal-400 rounded-full opacity-0 group-hover:opacity-20 transition-opacity animate-bounce" />
        </div>
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-full sm:w-96 max-w-[calc(100vw-24px)] h-screen sm:h-96 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-800">
            <h3 className="font-semibold text-white">Sprout 🌱 — your garden helper</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {isEmpty ? (
              <div className="h-full flex flex-col items-center justify-center">
                <p className="text-slate-400 text-sm mb-4">What can I help with?</p>
                <div className="space-y-2 w-full">
                  {suggestions.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => handleSendMessage(suggestion)}
                      className="w-full p-2 text-xs text-left bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors border border-slate-700"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                        msg.role === "user"
                          ? "bg-teal-600 text-white"
                          : "bg-slate-800 text-slate-100"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {/* Streaming content */}
                {streamingContent && (
                  <div className="flex justify-start">
                    <div className="max-w-xs px-3 py-2 rounded-lg text-sm bg-slate-800 text-slate-100">
                      {streamingContent}
                    </div>
                  </div>
                )}

                {/* Tool events */}
                {toolsRunning.size > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {Array.from(toolsRunning.values()).map((label, i) => (
                      <div
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded-full animate-shimmer"
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                )}

                {chatError && (
                  <div className="px-3 py-2 rounded-lg text-xs bg-red-500/10 border border-red-500/30 text-red-400">
                    {chatError}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-slate-800">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage(input);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Sprout..."
                className="flex-1 px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="px-3 py-2 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-700 text-white rounded font-medium transition-colors"
              >
                {isLoading ? "..." : "Send"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
