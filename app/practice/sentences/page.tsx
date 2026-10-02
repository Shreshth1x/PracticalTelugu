import type { Metadata } from "next";
import PalukuApp from "../../PalukuApp";

export const metadata: Metadata = {
  title: "Build sentences | PracticalTelugu",
  description: "Put practical Telugu phrases together in both directions using a vocabulary bank.",
};

export default function SentencesPage() {
  return <PalukuApp screen="practice" initialPracticeTab="sentences" />;
}
