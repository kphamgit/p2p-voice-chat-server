-- CreateTable
CREATE TABLE "DictEntry" (
    "id" SERIAL NOT NULL,
    "head_word" VARCHAR(100) NOT NULL,
    "hyphenated" VARCHAR(100) NOT NULL DEFAULT '',
    "source" VARCHAR(60),

    CONSTRAINT "DictEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartOfSpeech" (
    "id" SERIAL NOT NULL,
    "dict_entry_id" INTEGER NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "pron_code" VARCHAR(50),
    "amevar_pron" VARCHAR(50),
    "viet_pron_code" VARCHAR(255),
    "viet_pron_code_standard" VARCHAR(255),
    "viet_pron_regional_variant" VARCHAR(255) NOT NULL DEFAULT '',
    "frequency" VARCHAR(20),
    "grammar" VARCHAR(100),
    "video_url" TEXT,
    "audio_blob" VARCHAR(255) NOT NULL DEFAULT '',

    CONSTRAINT "PartOfSpeech_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sense" (
    "id" SERIAL NOT NULL,
    "pos_id" INTEGER NOT NULL,
    "sense_number" SMALLINT NOT NULL DEFAULT 0,
    "definition" TEXT,
    "def_translation" TEXT,
    "cross_reference" VARCHAR(400),
    "grammar" VARCHAR(80),
    "related_words" VARCHAR(200),

    CONSTRAINT "Sense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idiom" (
    "id" SERIAL NOT NULL,
    "pos_id" INTEGER NOT NULL,
    "phrase" TEXT,
    "translation" TEXT,

    CONSTRAINT "Idiom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Example" (
    "id" SERIAL NOT NULL,
    "sense_id" INTEGER NOT NULL,
    "example_number" SMALLINT NOT NULL DEFAULT 0,
    "difficulty_level" SMALLINT NOT NULL DEFAULT 0,
    "sentence" TEXT,
    "translation" TEXT,
    "grammar_point" VARCHAR(100),

    CONSTRAINT "Example_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DictEntry_head_word_source_key" ON "DictEntry"("head_word", "source");

-- AddForeignKey
ALTER TABLE "PartOfSpeech" ADD CONSTRAINT "PartOfSpeech_dict_entry_id_fkey" FOREIGN KEY ("dict_entry_id") REFERENCES "DictEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sense" ADD CONSTRAINT "Sense_pos_id_fkey" FOREIGN KEY ("pos_id") REFERENCES "PartOfSpeech"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idiom" ADD CONSTRAINT "Idiom_pos_id_fkey" FOREIGN KEY ("pos_id") REFERENCES "PartOfSpeech"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Example" ADD CONSTRAINT "Example_sense_id_fkey" FOREIGN KEY ("sense_id") REFERENCES "Sense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

