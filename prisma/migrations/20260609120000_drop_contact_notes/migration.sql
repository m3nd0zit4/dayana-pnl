-- Drop quick notes (ContactNote); clinical notes live in ContactNotebookPage only.
DROP TABLE IF EXISTS "contact_notes";
DROP TYPE IF EXISTS "ContactNoteKind";
