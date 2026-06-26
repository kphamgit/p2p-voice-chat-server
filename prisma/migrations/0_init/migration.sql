-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "api_assignment" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "quiz_id" BIGINT NOT NULL,
    "category_id" INTEGER,

    CONSTRAINT "api_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_assignmentstudent" (
    "id" BIGSERIAL NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL,
    "assignment_id" BIGINT NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "api_assignmentstudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_card" (
    "id" BIGSERIAL NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "difficulty" SMALLINT NOT NULL,
    "quiz_id" BIGINT,
    "definition" TEXT NOT NULL,

    CONSTRAINT "api_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_cardreview" (
    "id" BIGSERIAL NOT NULL,
    "easiness" DOUBLE PRECISION NOT NULL,
    "interval" INTEGER NOT NULL,
    "repetitions" INTEGER NOT NULL,
    "next_review_at" TIMESTAMPTZ(6),
    "card_id" BIGINT NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "api_cardreview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_category" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category_number" INTEGER NOT NULL,
    "level_id" BIGINT,

    CONSTRAINT "api_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_dictentry" (
    "id" BIGSERIAL NOT NULL,
    "head_word" VARCHAR(100) NOT NULL,
    "source" VARCHAR(60),

    CONSTRAINT "api_dictentry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_example" (
    "id" BIGSERIAL NOT NULL,
    "example_number" SMALLINT NOT NULL,
    "difficulty_level" SMALLINT NOT NULL,
    "sentence" TEXT,
    "translation" TEXT,
    "grammar_point" VARCHAR(100),
    "sense_id" BIGINT NOT NULL,

    CONSTRAINT "api_example_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_idiom" (
    "id" BIGSERIAL NOT NULL,
    "phrase" TEXT,
    "translation" TEXT,
    "pos_id" BIGINT NOT NULL,

    CONSTRAINT "api_idiom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_level" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "level_number" INTEGER NOT NULL,

    CONSTRAINT "api_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_partofspeech" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "pron_code" VARCHAR(50),
    "amevar_pron" VARCHAR(50),
    "frequency" VARCHAR(20),
    "grammar" VARCHAR(100),
    "dict_entry_id" BIGINT NOT NULL,

    CONSTRAINT "api_partofspeech_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_profile" (
    "id" BIGSERIAL NOT NULL,
    "group" VARCHAR(100) NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "api_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_question" (
    "id" BIGSERIAL NOT NULL,
    "question_number" INTEGER NOT NULL,
    "format" SMALLINT NOT NULL,
    "audio_str" VARCHAR(500),
    "instructions" TEXT,
    "prompt" TEXT,
    "content" TEXT NOT NULL,
    "answer_key" TEXT NOT NULL,
    "score" INTEGER,
    "timeout" INTEGER,
    "button_cloze_options" TEXT,
    "explanation" TEXT,
    "hint" VARCHAR(500),
    "quiz_id" BIGINT NOT NULL,
    "video_segment_id" BIGINT,
    "content_language" VARCHAR(10),
    "question_purpose" VARCHAR(50),

    CONSTRAINT "api_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_questionattempt" (
    "id" BIGSERIAL NOT NULL,
    "error_flag" BOOLEAN,
    "score" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "answer" VARCHAR(1000),
    "question_id" BIGINT NOT NULL,
    "quiz_attempt_id" BIGINT NOT NULL,
    "question_attempt_number" INTEGER NOT NULL,
    "corrected" BOOLEAN,
    "review_state" BOOLEAN NOT NULL,
    "stale" BOOLEAN NOT NULL,

    CONSTRAINT "api_questionattempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_quiz" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "quiz_number" INTEGER NOT NULL,
    "unit_id" BIGINT NOT NULL,
    "video_url" VARCHAR,

    CONSTRAINT "api_quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_quizattempt" (
    "id" BIGSERIAL NOT NULL,
    "user_name" VARCHAR(50) NOT NULL,
    "score" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completion_status" VARCHAR(50) NOT NULL,
    "errorneous_questions" VARCHAR(200) NOT NULL,
    "review_state" BOOLEAN NOT NULL,
    "quiz_id" BIGINT NOT NULL,

    CONSTRAINT "api_quizattempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_sense" (
    "id" BIGSERIAL NOT NULL,
    "sense_number" SMALLINT NOT NULL,
    "definition" TEXT,
    "def_translation" TEXT,
    "cross_reference" VARCHAR(400),
    "grammar" VARCHAR(80),
    "related_words" VARCHAR(200),
    "pos_id" BIGINT NOT NULL,

    CONSTRAINT "api_sense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_unit" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "unit_number" INTEGER NOT NULL,
    "category_id" BIGINT NOT NULL,

    CONSTRAINT "api_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_videosegment" (
    "id" BIGSERIAL NOT NULL,
    "start_time" VARCHAR(50) NOT NULL,
    "end_time" VARCHAR(50) NOT NULL,
    "quiz_id" BIGINT NOT NULL,
    "segment_number" INTEGER NOT NULL,

    CONSTRAINT "api_videosegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_group" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,

    CONSTRAINT "auth_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_group_permissions" (
    "id" BIGSERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "auth_group_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_permission" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "content_type_id" INTEGER NOT NULL,
    "codename" VARCHAR(100) NOT NULL,

    CONSTRAINT "auth_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user" (
    "id" SERIAL NOT NULL,
    "password" VARCHAR(128) NOT NULL,
    "last_login" TIMESTAMPTZ(6),
    "is_superuser" BOOLEAN NOT NULL,
    "username" VARCHAR(150) NOT NULL,
    "first_name" VARCHAR(150) NOT NULL,
    "last_name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "is_staff" BOOLEAN NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "date_joined" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user_groups" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,

    CONSTRAINT "auth_user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user_user_permissions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "auth_user_user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_admin_log" (
    "id" SERIAL NOT NULL,
    "action_time" TIMESTAMPTZ(6) NOT NULL,
    "object_id" TEXT,
    "object_repr" VARCHAR(200) NOT NULL,
    "action_flag" SMALLINT NOT NULL,
    "change_message" TEXT NOT NULL,
    "content_type_id" INTEGER,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "django_admin_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_content_type" (
    "id" SERIAL NOT NULL,
    "app_label" VARCHAR(100) NOT NULL,
    "model" VARCHAR(100) NOT NULL,

    CONSTRAINT "django_content_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_migrations" (
    "id" BIGSERIAL NOT NULL,
    "app" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "applied" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "django_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_session" (
    "session_key" VARCHAR(40) NOT NULL,
    "session_data" TEXT NOT NULL,
    "expire_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "django_session_pkey" PRIMARY KEY ("session_key")
);

-- CreateIndex
CREATE INDEX "api_assignment_quiz_id_35c4fdae" ON "api_assignment"("quiz_id");

-- CreateIndex
CREATE INDEX "api_assignmentstudent_assignment_id_c68d0cc2" ON "api_assignmentstudent"("assignment_id");

-- CreateIndex
CREATE INDEX "api_assignmentstudent_user_id_645ac643" ON "api_assignmentstudent"("user_id");

-- CreateIndex
CREATE INDEX "api_card_quiz_id_72970dcf" ON "api_card"("quiz_id");

-- CreateIndex
CREATE INDEX "api_cardreview_card_id_0ff66926" ON "api_cardreview"("card_id");

-- CreateIndex
CREATE INDEX "api_cardreview_user_id_1c43bb85" ON "api_cardreview"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_cardreview_user_id_card_id_097fbde4_uniq" ON "api_cardreview"("user_id", "card_id");

-- CreateIndex
CREATE INDEX "api_category_level_id_86ace77f" ON "api_category"("level_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_dictentry_head_word_source_69e2b31e_uniq" ON "api_dictentry"("head_word", "source");

-- CreateIndex
CREATE INDEX "api_example_sense_id_1bff6c7e" ON "api_example"("sense_id");

-- CreateIndex
CREATE INDEX "api_idiom_pos_id_574ca325" ON "api_idiom"("pos_id");

-- CreateIndex
CREATE INDEX "api_partofspeech_dict_entry_id_0a018e4b" ON "api_partofspeech"("dict_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_profile_user_id_key" ON "api_profile"("user_id");

-- CreateIndex
CREATE INDEX "api_question_quiz_id_72d0bb99" ON "api_question"("quiz_id");

-- CreateIndex
CREATE INDEX "api_question_video_segment_id_1e8d812f" ON "api_question"("video_segment_id");

-- CreateIndex
CREATE INDEX "api_questionattempt_question_id_837a885e" ON "api_questionattempt"("question_id");

-- CreateIndex
CREATE INDEX "api_questionattempt_quiz_attempt_id_3b07976b" ON "api_questionattempt"("quiz_attempt_id");

-- CreateIndex
CREATE INDEX "api_quiz_unit_id_cc3012fe" ON "api_quiz"("unit_id");

-- CreateIndex
CREATE INDEX "api_quizattempt_quiz_id_4b081504" ON "api_quizattempt"("quiz_id");

-- CreateIndex
CREATE INDEX "api_sense_pos_id_0281e638" ON "api_sense"("pos_id");

-- CreateIndex
CREATE INDEX "api_unit_category_id_4e8364f7" ON "api_unit"("category_id");

-- CreateIndex
CREATE INDEX "api_videosegment_quiz_id_f0dd4244" ON "api_videosegment"("quiz_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_group_name_key" ON "auth_group"("name");

-- CreateIndex
CREATE INDEX "auth_group_name_a6ea08ec_like" ON "auth_group"("name");

-- CreateIndex
CREATE INDEX "auth_group_permissions_group_id_b120cbf9" ON "auth_group_permissions"("group_id");

-- CreateIndex
CREATE INDEX "auth_group_permissions_permission_id_84c5c92e" ON "auth_group_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_group_permissions_group_id_permission_id_0cd325b0_uniq" ON "auth_group_permissions"("group_id", "permission_id");

-- CreateIndex
CREATE INDEX "auth_permission_content_type_id_2f476e4b" ON "auth_permission"("content_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_permission_content_type_id_codename_01ab375a_uniq" ON "auth_permission"("content_type_id", "codename");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_username_key" ON "auth_user"("username");

-- CreateIndex
CREATE INDEX "auth_user_username_6821ab7c_like" ON "auth_user"("username");

-- CreateIndex
CREATE INDEX "auth_user_groups_group_id_97559544" ON "auth_user_groups"("group_id");

-- CreateIndex
CREATE INDEX "auth_user_groups_user_id_6a12ed8b" ON "auth_user_groups"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_groups_user_id_group_id_94350c0c_uniq" ON "auth_user_groups"("user_id", "group_id");

-- CreateIndex
CREATE INDEX "auth_user_user_permissions_permission_id_1fbb5f2c" ON "auth_user_user_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "auth_user_user_permissions_user_id_a95ead1b" ON "auth_user_user_permissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_user_permissions_user_id_permission_id_14a6b632_uniq" ON "auth_user_user_permissions"("user_id", "permission_id");

-- CreateIndex
CREATE INDEX "django_admin_log_content_type_id_c4bce8eb" ON "django_admin_log"("content_type_id");

-- CreateIndex
CREATE INDEX "django_admin_log_user_id_c564eba6" ON "django_admin_log"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "django_content_type_app_label_model_76bd3d3b_uniq" ON "django_content_type"("app_label", "model");

-- CreateIndex
CREATE INDEX "django_session_expire_date_a5c62663" ON "django_session"("expire_date");

-- CreateIndex
CREATE INDEX "django_session_session_key_c0390e0f_like" ON "django_session"("session_key");

-- AddForeignKey
ALTER TABLE "api_assignment" ADD CONSTRAINT "api_assignment_quiz_id_35c4fdae_fk_api_quiz_id" FOREIGN KEY ("quiz_id") REFERENCES "api_quiz"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_assignmentstudent" ADD CONSTRAINT "api_assignmentstuden_assignment_id_c68d0cc2_fk_api_assig" FOREIGN KEY ("assignment_id") REFERENCES "api_assignment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_assignmentstudent" ADD CONSTRAINT "api_assignmentstudent_user_id_645ac643_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_card" ADD CONSTRAINT "api_card_quiz_id_72970dcf_fk_api_quiz_id" FOREIGN KEY ("quiz_id") REFERENCES "api_quiz"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_cardreview" ADD CONSTRAINT "api_cardreview_card_id_0ff66926_fk_api_card_id" FOREIGN KEY ("card_id") REFERENCES "api_card"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_cardreview" ADD CONSTRAINT "api_cardreview_user_id_1c43bb85_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_category" ADD CONSTRAINT "api_category_level_id_86ace77f_fk_api_level_id" FOREIGN KEY ("level_id") REFERENCES "api_level"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_example" ADD CONSTRAINT "api_example_sense_id_1bff6c7e_fk_api_sense_id" FOREIGN KEY ("sense_id") REFERENCES "api_sense"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_idiom" ADD CONSTRAINT "api_idiom_pos_id_574ca325_fk_api_partofspeech_id" FOREIGN KEY ("pos_id") REFERENCES "api_partofspeech"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_partofspeech" ADD CONSTRAINT "api_partofspeech_dict_entry_id_0a018e4b_fk_api_dictentry_id" FOREIGN KEY ("dict_entry_id") REFERENCES "api_dictentry"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_profile" ADD CONSTRAINT "api_profile_user_id_41309820_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_question" ADD CONSTRAINT "api_question_quiz_id_72d0bb99_fk_api_quiz_id" FOREIGN KEY ("quiz_id") REFERENCES "api_quiz"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_question" ADD CONSTRAINT "api_question_video_segment_id_1e8d812f_fk_api_videosegment_id" FOREIGN KEY ("video_segment_id") REFERENCES "api_videosegment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_questionattempt" ADD CONSTRAINT "api_questionattempt_question_id_837a885e_fk_api_question_id" FOREIGN KEY ("question_id") REFERENCES "api_question"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_questionattempt" ADD CONSTRAINT "api_questionattempt_quiz_attempt_id_3b07976b_fk_api_quiza" FOREIGN KEY ("quiz_attempt_id") REFERENCES "api_quizattempt"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_quiz" ADD CONSTRAINT "api_quiz_unit_id_cc3012fe_fk_api_unit_id" FOREIGN KEY ("unit_id") REFERENCES "api_unit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_quizattempt" ADD CONSTRAINT "api_quizattempt_quiz_id_4b081504_fk_api_quiz_id" FOREIGN KEY ("quiz_id") REFERENCES "api_quiz"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_sense" ADD CONSTRAINT "api_sense_pos_id_0281e638_fk_api_partofspeech_id" FOREIGN KEY ("pos_id") REFERENCES "api_partofspeech"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_unit" ADD CONSTRAINT "api_unit_category_id_4e8364f7_fk_api_category_id" FOREIGN KEY ("category_id") REFERENCES "api_category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_videosegment" ADD CONSTRAINT "api_videosegment_quiz_id_f0dd4244_fk_api_quiz_id" FOREIGN KEY ("quiz_id") REFERENCES "api_quiz"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_group_permissions" ADD CONSTRAINT "auth_group_permissio_permission_id_84c5c92e_fk_auth_perm" FOREIGN KEY ("permission_id") REFERENCES "auth_permission"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_group_permissions" ADD CONSTRAINT "auth_group_permissions_group_id_b120cbf9_fk_auth_group_id" FOREIGN KEY ("group_id") REFERENCES "auth_group"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_permission" ADD CONSTRAINT "auth_permission_content_type_id_2f476e4b_fk_django_co" FOREIGN KEY ("content_type_id") REFERENCES "django_content_type"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_groups" ADD CONSTRAINT "auth_user_groups_group_id_97559544_fk_auth_group_id" FOREIGN KEY ("group_id") REFERENCES "auth_group"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_groups" ADD CONSTRAINT "auth_user_groups_user_id_6a12ed8b_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_user_permissions" ADD CONSTRAINT "auth_user_user_permi_permission_id_1fbb5f2c_fk_auth_perm" FOREIGN KEY ("permission_id") REFERENCES "auth_permission"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_user_permissions" ADD CONSTRAINT "auth_user_user_permissions_user_id_a95ead1b_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "django_admin_log" ADD CONSTRAINT "django_admin_log_content_type_id_c4bce8eb_fk_django_co" FOREIGN KEY ("content_type_id") REFERENCES "django_content_type"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "django_admin_log" ADD CONSTRAINT "django_admin_log_user_id_c564eba6_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

