import { useEffect, useRef, useState } from "react";
import { Hourglass, LockKeyhole, Mic, MicOff, RotateCcw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatMessageList } from "@/features/app/components/ChatMessageList";
import { useChatThread } from "./useChatThread";

const SPEECH_RECOGNITION_UNSUPPORTED =
  "Input suara gratis hanya didukung di browser tertentu seperti Chrome atau Edge. Kamu masih bisa mengetik transaksi.";
const HELP_PROMPT = "Sura bisa apa?";

export function AppChatPage() {
  const [message, setMessage] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("");
  const chatScrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const voiceHadErrorRef = useRef(false);
  const voiceSubmitStartedRef = useRef(false);
  const SpeechRecognition =
    typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  const isSpeechSupported = Boolean(SpeechRecognition);
  const hasDraftMessage = Boolean(message.trim());
  const {
    answerClarification,
    cancelItem,
    chatItems,
    clearThread,
    confirmItem,
    isBusy,
    isClearingChat,
    isUndoingLatest,
    pendingConfirmationRequestId,
    status,
    submitMessage,
    threadLoading,
    undoLatestTransaction,
  } = useChatThread();

  function scrollChatToBottom(behavior = "smooth") {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior,
    });
  }

  useEffect(() => {
    if (threadLoading) return;
    scrollChatToBottom(chatItems.length <= 1 ? "auto" : "smooth");
  }, [chatItems.length, status, threadLoading]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  async function sendMessageText(text) {
    if (!text.trim() || isBusy) return false;

    const submittedMessage = text.trim();
    setMessage("");
    const sent = await submitMessage(submittedMessage);

    if (!sent) {
      setMessage(submittedMessage);
    }

    return sent;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (hasDraftMessage) {
      await sendMessageText(message);
      return;
    }

    handleMicClick();
  }

  async function submitVoiceTranscript() {
    if (voiceSubmitStartedRef.current) return;

    const transcript = finalTranscriptRef.current.trim();
    if (!transcript) {
      setVoiceStatus("");
      setVoiceError("Suara belum terbaca. Coba tekan mic lalu bicara lagi.");
      return;
    }

    voiceSubmitStartedRef.current = true;
    setVoiceStatus("Mengirim hasil suara...");
    setVoiceError("");

    await sendMessageText(transcript);
    setVoiceStatus("");
  }

  function handleVoiceError(error) {
    const messages = {
      "not-allowed": "Izin mikrofon ditolak. Aktifkan izin mic di browser untuk memakai suara.",
      "service-not-allowed": "Izin mikrofon ditolak. Aktifkan izin mic di browser untuk memakai suara.",
      "no-speech": "Suara belum terdengar. Coba tekan mic lalu bicara lagi.",
      "audio-capture": "Mikrofon tidak ditemukan. Periksa perangkat mic kamu.",
      network: "Koneksi pengenal suara bermasalah. Coba lagi sebentar.",
    };

    voiceHadErrorRef.current = true;
    setVoiceError(messages[error] ?? "Input suara belum bisa diproses. Coba lagi ya.");
    setVoiceStatus("");
  }

  function handleMicClick() {
    if (isBusy) return;

    if (!SpeechRecognition) {
      setVoiceError(SPEECH_RECOGNITION_UNSUPPORTED);
      setVoiceStatus("");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setVoiceStatus("Memproses suara...");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "id-ID";
    recognition.interimResults = true;
    recognition.continuous = false;

    finalTranscriptRef.current = "";
    voiceHadErrorRef.current = false;
    voiceSubmitStartedRef.current = false;
    setVoiceError("");
    setVoiceStatus("Mendengarkan...");

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceStatus("Mendengarkan...");
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript ?? "";
        if (event.results[index].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript.trim()) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalTranscript}`.trim();
      }

      setMessage(`${finalTranscriptRef.current} ${interimTranscript}`.trim());
    };

    recognition.onerror = (event) => {
      handleVoiceError(event.error);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;

      if (!voiceHadErrorRef.current) {
        void submitVoiceTranscript();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceStatus("");
      setVoiceError("Input suara belum bisa dimulai. Coba lagi sebentar.");
    }
  }

  if (threadLoading) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center overflow-hidden bg-card shadow-sm sm:rounded-xl sm:border sm:border-border">
        <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
          <Hourglass className="h-10 w-10 animate-spin text-primary" aria-hidden />
          <div>
            <h2 className="su-type-section-title text-foreground">Memuat obrolan...</h2>
            <p className="su-type-body mt-1 text-muted-foreground">Mohon tunggu sebentar.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card shadow-sm sm:rounded-xl sm:border sm:border-border">
      <header className="border-b border-border bg-card px-3 py-3 sm:px-4 md:px-6">
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full border border-border bg-secondary/50 sm:h-11 sm:w-11" aria-hidden />
            <div className="min-w-0">
              <p className="su-type-ui truncate text-foreground">Sura</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                <span className="text-xs text-muted-foreground">Online</span>
              </div>
            </div>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy || isUndoingLatest}
              onClick={undoLatestTransaction}
              className="h-9 flex-1 gap-2 px-3 sm:flex-none"
            >
              <RotateCcw aria-hidden className="h-4 w-4" />
              {isUndoingLatest ? "Undo..." : "Undo"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isBusy || isClearingChat}
              onClick={clearThread}
              className="h-9 flex-1 gap-2 px-3 sm:flex-none"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
              {isClearingChat ? "Membersihkan..." : "Clear Chat"}
            </Button>
          </div>
        </div>
      </header>

      <div ref={chatScrollRef} className="su-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 md:px-6">
        <ChatMessageList
          chatItems={chatItems}
          isBusy={isBusy}
          onCancel={cancelItem}
          onClarificationAnswer={answerClarification}
          onConfirm={confirmItem}
          onHelpRequest={() => sendMessageText(HELP_PROMPT)}
          pendingConfirmationRequestId={pendingConfirmationRequestId}
        />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border bg-card px-3 py-3 sm:px-4 sm:py-4 md:px-6">
        <div className="flex gap-2 sm:gap-3">
          <div className="flex min-h-12 flex-1 items-center gap-3 rounded-lg border border-border bg-card px-3 shadow-sm focus-within:border-primary/45 focus-within:ring-3 focus-within:ring-ring/15 sm:min-h-14 sm:px-4">
            <input
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={isBusy}
              placeholder="Tulis transaksi usaha..."
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <Button
            type="submit"
            disabled={isBusy || isListening}
            aria-pressed={!hasDraftMessage && isListening}
            className={cn(
              "h-12 gap-2 px-4 transition-all duration-200 sm:h-14 sm:px-5",
              !hasDraftMessage && "min-w-[6.75rem]",
              !hasDraftMessage && isListening && "shadow-[0_0_0_6px_hsl(var(--primary)/0.14)]",
              !hasDraftMessage && !isSpeechSupported && "bg-muted text-muted-foreground hover:bg-muted",
            )}
          >
            {hasDraftMessage ? (
              <>
                <Send aria-hidden className="h-4 w-4" />
                <span className="hidden sm:inline">Kirim</span>
              </>
            ) : isSpeechSupported ? (
              <>
                <span className="relative flex items-center justify-center">
                  {isListening ? (
                    <span className="absolute h-7 w-7 animate-ping rounded-full bg-primary-foreground/25" aria-hidden />
                  ) : null}
                  <Mic aria-hidden className="relative h-4 w-4" />
                </span>
                <span>{isListening ? "Dengar" : "Bicara"}</span>
              </>
            ) : (
              <>
                <MicOff aria-hidden className="h-4 w-4" />
                <span>Bicara</span>
              </>
            )}
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <LockKeyhole aria-hidden className="h-3.5 w-3.5" />
            <span>Data hanya disimpan setelah kamu konfirmasi.</span>
          </div>
          <p
            aria-live="polite"
            className={cn("min-h-4 text-left sm:text-right", voiceError ? "text-destructive" : "text-muted-foreground")}
          >
            {voiceError || voiceStatus || (!isSpeechSupported ? SPEECH_RECOGNITION_UNSUPPORTED : "")}
          </p>
        </div>
      </form>
    </section>
  );
}
