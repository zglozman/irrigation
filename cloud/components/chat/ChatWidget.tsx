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
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [toolsRunning, setToolsRunning] = useState<Map<string, string>>(new Map());
  const [chatError, setChatError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Exit along the same path the panel entered (slide back toward the pill).
  const closePanel = () => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setClosing(false);
    }, 180);
  };

  const togglePanel = () => {
    if (isOpen) closePanel();
    else setIsOpen(true);
  };

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
      {/* "ask sprout" pill — replaces the round FAB */}
      <button
        onClick={togglePanel}
        className="press fixed bottom-[96px] right-4 z-40 flex min-h-[44px] items-center gap-2 rounded-full bg-gradient-to-br from-[#38a457] to-leaf px-[18px] py-3 [box-shadow:0_8px_22px_#2f8f4e4d] md:bottom-6 md:right-6"
        aria-label="Open Sprout chat"
      >
        <span className="text-[17px]" aria-hidden="true">
          🌱
        </span>
        <span className="text-[13px] font-bold text-white">ask sprout</span>
      </button>

      {/* Chat panel — anchored to the pill; enters and exits to the right */}
      {isOpen && (
        <div
          className={`${closing ? "anim-chat-out" : "anim-chat-in"} card fixed bottom-[152px] right-4 z-50 flex h-96 max-h-[60vh] w-full max-w-[calc(100vw-32px)] flex-col overflow-hidden border border-hairline [box-shadow:0_12px_40px_#24382a24] sm:w-96 md:bottom-24 md:right-6`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <h3 className="font-display text-[14px] font-semibold tracking-[-0.01em] text-ink">
              sprout 🌱 — your garden helper
            </h3>
            <button
              onClick={closePanel}
              className="press -m-2 flex h-10 w-10 items-center justify-center rounded-full text-fern hover:text-ink"
              aria-label="Close chat"
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {isEmpty ? (
              <div className="flex h-full flex-col items-center justify-center">
                <p className="mb-4 text-sm text-fern">What can I help with?</p>
                <div className="w-full space-y-2">
                  {suggestions.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => handleSendMessage(suggestion)}
                      className="press w-full rounded-xl border border-inputb bg-white p-2.5 text-left text-xs text-sec hover:bg-tint"
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
                      className={`max-w-xs px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "rounded-2xl rounded-br-md bg-leaf text-white"
                          : "rounded-2xl rounded-bl-md bg-track text-ink"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {/* Streaming content */}
                {streamingContent && (
                  <div className="flex justify-start">
                    <div className="max-w-xs rounded-2xl rounded-bl-md bg-track px-3 py-2 text-sm text-ink">
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
                        className="animate-shimmer inline-flex items-center gap-1 rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-leafdark"
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                )}

                {chatError && (
                  <div className="rounded-xl bg-claytint px-3 py-2 text-xs text-clay">
                    {chatError}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-hairline p-3">
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
                className="h-11 min-w-0 flex-1 rounded-full bg-track px-4 text-sm text-ink placeholder-fern focus:outline-none focus:ring-2 focus:ring-leaflight"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="pill pill-primary h-11 px-4 text-sm"
              >
                {isLoading ? "…" : "send"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
