import type { Metadata } from "next";
import PalukuApp from "../PalukuApp";

export const metadata: Metadata = {
  title: "Practice Live | PracticalTelugu",
  description:
    "Practice a short, practical Telugu conversation out loud with Mayu.",
};

export default function PracticeLivePage() {
  return <PalukuApp screen="practice-live" />;
}
