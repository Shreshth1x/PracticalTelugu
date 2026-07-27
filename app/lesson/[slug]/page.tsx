import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PalukuApp from "../../PalukuApp";
import { findLesson } from "../../course-data";

type LessonPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: LessonPageProps): Promise<Metadata> {
  const { slug } = await params;
  const lesson = findLesson(slug);
  return {
    title: lesson
      ? `${lesson.title} · PalukuLingo`
      : "Telugu practice · PalukuLingo",
    description: lesson?.description,
  };
}

export default async function LessonPage({ params }: LessonPageProps) {
  const { slug } = await params;
  if (!findLesson(slug)) notFound();
  return <PalukuApp screen="lesson" initialLessonId={slug} />;
}
