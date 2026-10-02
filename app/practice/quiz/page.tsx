import type { Metadata } from "next";
import PalukuApp from "../../PalukuApp";

export const metadata: Metadata = {
  title: "Daily quiz | PracticalTelugu",
  description: "Review Telugu with ten daily questions about meaning, translation, listening, and when to use a phrase.",
};

export default function QuizPage() {
  return <PalukuApp screen="practice" initialPracticeTab="quiz" />;
}
