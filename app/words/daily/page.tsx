import type { Metadata } from "next";
import PalukuApp from "../../PalukuApp";

export const metadata: Metadata = {
  title: "Practical path | PracticalTelugu",
  description:
    "Move through practical Telugu five phrases at a time and always resume where you left off.",
};

export default function DailyWordsPage() {
  return <PalukuApp screen="daily" />;
}
