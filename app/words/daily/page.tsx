import type { Metadata } from "next";
import PalukuApp from "../../PalukuApp";

export const metadata: Metadata = {
  title: "Quick five · PalukuLingo",
  description: "Five practical Telugu phrases to get ready for a real conversation.",
};

export default function DailyWordsPage() {
  return <PalukuApp screen="daily" />;
}
