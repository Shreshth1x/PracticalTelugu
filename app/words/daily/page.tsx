import type { Metadata } from "next";
import PalukuApp from "../../PalukuApp";

export const metadata: Metadata = {
  title: "Today’s five words · PalukuLingo",
  description: "A quiet five-word Telugu session for today.",
};

export default function DailyWordsPage() {
  return <PalukuApp screen="daily" />;
}
