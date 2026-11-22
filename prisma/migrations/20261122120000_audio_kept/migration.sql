-- Audio.inLibrary (in_library) is now Audio.kept: an audio chosen to keep (searchable, never
-- deleted automatically), as opposed to a take nobody kept. A rename, so no data is lost.
ALTER TABLE "Audio" RENAME COLUMN "in_library" TO "kept";
ALTER INDEX "Audio_in_library_created_at_idx" RENAME TO "Audio_kept_created_at_idx";
