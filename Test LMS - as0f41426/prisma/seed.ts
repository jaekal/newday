import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { seedCatalogCourses } from "./seed-catalog";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL environment variable is not set");
const adapter = new PrismaPg({ connectionString });
const db = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  const hash = (pw: string) => bcrypt.hash(pw, 12);

  // ── Users ──────────────────────────────────────────────────────────────────
  const admin = await db.user.upsert({
    where: { email: "admin@learnhub.dev" },
    update: {},
    create: {
      name: "Admin User",
      email: "admin@learnhub.dev",
      passwordHash: await hash("admin123"),
      role: "ADMIN",
    },
  });

  const instructor = await db.user.upsert({
    where: { email: "instructor@learnhub.dev" },
    update: {},
    create: {
      name: "Jane Instructor",
      email: "instructor@learnhub.dev",
      passwordHash: await hash("instructor123"),
      role: "INSTRUCTOR",
      bio: "Experienced software engineer and educator with 10+ years of industry experience.",
    },
  });

  const students = await Promise.all(
    [
      { name: "Alice Student", email: "alice@learnhub.dev" },
      { name: "Bob Student", email: "bob@learnhub.dev" },
      { name: "Carol Student", email: "carol@learnhub.dev" },
    ].map(async (s) =>
      db.user.upsert({
        where: { email: s.email },
        update: {},
        create: { ...s, passwordHash: await hash("student123"), role: "STUDENT" },
      })
    )
  );

  console.log("✓ Users created");

  // ── Course ─────────────────────────────────────────────────────────────────
  const course = await db.course.upsert({
    where: { id: "seed-course-1" },
    update: {
      imageUrl: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&w=1200&q=80",
    },
    create: {
      id: "seed-course-1",
      title: "Introduction to Web Development",
      description:
        "Learn the fundamentals of HTML, CSS, and JavaScript. Build your first web pages and understand how the modern web works.",
      imageUrl: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&w=1200&q=80",
      status: "PUBLISHED",
      instructorId: instructor.id,
    },
  });

  // ── Modules ────────────────────────────────────────────────────────────────
  const moduleData = [
    {
      id: "seed-mod-1",
      title: "HTML Fundamentals",
      description: "Structure the web with HTML5",
      order: 1,
      content: `# HTML Fundamentals

HTML (HyperText Markup Language) is the backbone of every web page. In this module, you will learn:

- How to create a basic HTML document structure
- Common HTML elements: headings, paragraphs, lists, links, images
- Semantic HTML5 elements like <header>, <nav>, <main>, <article>, <footer>
- Forms and input elements

## Getting Started

Every HTML page starts with a doctype declaration and a basic structure:

\`\`\`html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My First Page</title>
  </head>
  <body>
    <h1>Hello, World!</h1>
  </body>
</html>
\`\`\`

Practice by creating a simple "About Me" page using the elements covered above.`,
    },
    {
      id: "seed-mod-2",
      title: "CSS Styling",
      description: "Make your pages look great with CSS",
      order: 2,
      content: `# CSS Styling

CSS (Cascading Style Sheets) controls the visual presentation of your HTML. Topics covered:

- Selectors, properties, and values
- The box model: margin, border, padding, content
- Colors and typography
- Flexbox and Grid layouts
- Responsive design with media queries

## The Box Model

Every element on a web page is a rectangular box. Understanding this is key to layouts.

Try styling the page you created in the HTML module. Experiment with colors, fonts, and layout.`,
    },
    {
      id: "seed-mod-3",
      title: "JavaScript Basics",
      description: "Add interactivity with JavaScript",
      order: 3,
      content: `# JavaScript Basics

JavaScript makes web pages interactive. In this module:

- Variables, data types, and operators
- Functions and scope
- DOM manipulation
- Events and event listeners
- Fetch API for loading data

## Your First Script

Add a button to your HTML page that changes the background color when clicked. This will require event listeners and DOM manipulation.`,
    },
  ];

  for (const m of moduleData) {
    await db.module.upsert({
      where: { id: m.id },
      update: {},
      create: { ...m, courseId: course.id },
    });
  }

  console.log("✓ Modules created");

  // ── Questions ──────────────────────────────────────────────────────────────
  const questions = await Promise.all([
    db.question.upsert({
      where: { id: "seed-q-1" },
      update: {},
      create: {
        id: "seed-q-1",
        authorId: instructor.id,
        courseId: course.id,
        type: "MULTIPLE_CHOICE",
        difficulty: "EASY",
        points: 1,
        stem: "Which HTML tag is used to create the largest heading?",
        explanation: "<h1> represents the top-level heading and is the largest by default.",
        tags: ["html", "headings"],
        options: [
          { id: "a", text: "<h1>", isCorrect: true },
          { id: "b", text: "<h6>", isCorrect: false },
          { id: "c", text: "<heading>", isCorrect: false },
          { id: "d", text: "<title>", isCorrect: false },
        ],
        correctAnswer: "a",
      },
    }),
    db.question.upsert({
      where: { id: "seed-q-2" },
      update: {},
      create: {
        id: "seed-q-2",
        authorId: instructor.id,
        courseId: course.id,
        type: "TRUE_FALSE",
        difficulty: "EASY",
        points: 1,
        stem: "CSS stands for Cascading Style Sheets.",
        explanation: "CSS stands for Cascading Style Sheets, which is used to style HTML elements.",
        tags: ["css", "basics"],
        options: [
          { id: "true", text: "True", isCorrect: true },
          { id: "false", text: "False", isCorrect: false },
        ],
        correctAnswer: "true",
      },
    }),
    db.question.upsert({
      where: { id: "seed-q-3" },
      update: {},
      create: {
        id: "seed-q-3",
        authorId: instructor.id,
        courseId: course.id,
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Which CSS property controls the space between an element's content and its border?",
        explanation: "The 'padding' property controls the inner space between content and border.",
        tags: ["css", "box-model"],
        options: [
          { id: "a", text: "margin", isCorrect: false },
          { id: "b", text: "padding", isCorrect: true },
          { id: "c", text: "border-spacing", isCorrect: false },
          { id: "d", text: "gap", isCorrect: false },
        ],
        correctAnswer: "b",
      },
    }),
    db.question.upsert({
      where: { id: "seed-q-4" },
      update: {},
      create: {
        id: "seed-q-4",
        authorId: instructor.id,
        courseId: course.id,
        type: "MULTI_SELECT",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Which of the following are valid JavaScript data types? (Select all that apply)",
        explanation: "JavaScript has 7 primitive types: string, number, bigint, boolean, undefined, symbol, and null. Arrays and objects are reference types.",
        tags: ["javascript", "data-types"],
        options: [
          { id: "a", text: "string", isCorrect: true },
          { id: "b", text: "integer", isCorrect: false },
          { id: "c", text: "boolean", isCorrect: true },
          { id: "d", text: "undefined", isCorrect: true },
          { id: "e", text: "character", isCorrect: false },
        ],
        correctAnswer: JSON.stringify(["a", "c", "d"]),
      },
    }),
    db.question.upsert({
      where: { id: "seed-q-5" },
      update: {},
      create: {
        id: "seed-q-5",
        authorId: instructor.id,
        courseId: course.id,
        type: "FILL_IN_BLANK",
        difficulty: "MEDIUM",
        points: 1,
        stem: "The HTML attribute used to specify the URL of a link is ___.",
        explanation: "The 'href' attribute on an <a> tag specifies the destination URL.",
        tags: ["html", "attributes"],
        correctAnswer: "href",
      },
    }),
    db.question.upsert({
      where: { id: "seed-q-6" },
      update: {},
      create: {
        id: "seed-q-6",
        authorId: instructor.id,
        courseId: course.id,
        type: "SHORT_ANSWER",
        difficulty: "HARD",
        points: 3,
        stem: "Explain the difference between 'margin' and 'padding' in CSS.",
        explanation: "Margin is the space outside the element's border; padding is the space inside the border between the border and the content.",
        tags: ["css", "box-model"],
      },
    }),
    db.question.upsert({
      where: { id: "seed-q-7" },
      update: {},
      create: {
        id: "seed-q-7",
        authorId: instructor.id,
        courseId: course.id,
        type: "MULTIPLE_CHOICE",
        difficulty: "HARD",
        points: 2,
        stem: "What does the 'this' keyword refer to inside an arrow function?",
        explanation: "Arrow functions do not have their own 'this'. They inherit 'this' from the surrounding lexical context.",
        tags: ["javascript", "functions", "scope"],
        options: [
          { id: "a", text: "The function itself", isCorrect: false },
          { id: "b", text: "The global object (window)", isCorrect: false },
          { id: "c", text: "The surrounding lexical context", isCorrect: true },
          { id: "d", text: "undefined always", isCorrect: false },
        ],
        correctAnswer: "c",
      },
    }),
  ]);

  console.log("✓ Questions created");

  // ── Assessment ─────────────────────────────────────────────────────────────
  const assessment = await db.assessment.upsert({
    where: { id: "seed-assessment-1" },
    update: {},
    create: {
      id: "seed-assessment-1",
      courseId: course.id,
      title: "Web Development Fundamentals Quiz",
      description: "Test your knowledge of HTML, CSS, and JavaScript basics.",
      type: "QUIZ",
      timeLimit: 20,
      maxAttempts: 3,
      passingScore: 70,
      shuffleQuestions: true,
      shuffleOptions: true,
      showFeedback: true,
    },
  });

  // Link questions to assessment
  for (let i = 0; i < questions.length; i++) {
    await db.assessmentQuestion.upsert({
      where: { assessmentId_questionId: { assessmentId: assessment.id, questionId: questions[i].id } },
      update: {},
      create: {
        assessmentId: assessment.id,
        questionId: questions[i].id,
        order: i,
        isPinned: true,
      },
    });
  }

  console.log("✓ Assessment created");

  // ── Enrollments ────────────────────────────────────────────────────────────
  for (const student of students) {
    await db.enrollment.upsert({
      where: { userId_courseId: { userId: student.id, courseId: course.id } },
      update: {},
      create: { userId: student.id, courseId: course.id, status: "ACTIVE" },
    });
  }

  console.log("✓ Enrollments created");

  await seedCatalogCourses(
    db,
    instructor.id,
    students.map((s) => s.id)
  );

  console.log("\n✅ Seed complete!");
  console.log("\nDemo accounts:");
  console.log("  Admin:      admin@learnhub.dev        / admin123");
  console.log("  Instructor: instructor@learnhub.dev   / instructor123");
  console.log("  Student:    alice@learnhub.dev         / student123");
  console.log("  Student:    bob@learnhub.dev           / student123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
