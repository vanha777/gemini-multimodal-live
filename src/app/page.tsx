import LiveInterface from "@/components/live-interface";

export default function Home() {
  const apiKey = process.env.GEMINI_API_KEY || "";
  return (
    <main className="min-h-screen bg-black">
      <LiveInterface defaultApiKey={apiKey} />
    </main>
  );
}
