import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // add other tables here

    // Audiobooks: one uploaded document turned into a narrated audiobook.
    books: defineTable({
      userId: v.id("users"),
      title: v.string(),
      fileName: v.string(),
      charCount: v.number(),
      wordCount: v.number(),
      // estimated listening minutes at ~150 wpm
      estMinutes: v.number(),
      voiceName: v.string(),
      status: v.union(
        v.literal("generating"),
        v.literal("ready"),
        v.literal("error"),
      ),
      totalSegments: v.number(),
      readySegments: v.number(),
      error: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // Segments: text chunks of a book, each rendered to one MP3 in storage.
    segments: defineTable({
      bookId: v.id("books"),
      idx: v.number(),
      text: v.string(),
      charCount: v.number(),
      status: v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("ready"),
        v.literal("error"),
      ),
      storageId: v.optional(v.id("_storage")),
      bytes: v.optional(v.number()),
      error: v.optional(v.string()),
    }).index("by_book", ["bookId", "idx"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
