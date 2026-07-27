import type { Metadata } from "next";
import PalukuApp from "./PalukuApp";

export const metadata: Metadata = {
  title: "Today | PracticalTelugu",
  description:
    "Practice five useful Telugu phrases, then choose a real-life situation.",
};

export default function Home() {
  return <PalukuApp screen="today" />;
}
