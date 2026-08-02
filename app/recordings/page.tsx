import type { Metadata } from "next";
import { RecorderStudio } from "./RecorderStudio";

export const metadata: Metadata = {
  title: "Voice recorder | PracticalTelugu",
  description: "Record a family voice for PracticalTelugu phrases.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RecordingsPage() {
  return <RecorderStudio />;
}
