import type { Metadata } from "next";
import PalukuApp from "../PalukuApp";

export const metadata: Metadata = {
  title: "Practice | PracticalTelugu",
  description: "Find Telugu by topic, build sentences, and keep it fresh with a daily quiz.",
};

export default function PracticePage() {
  return <PalukuApp screen="practice" />;
}
