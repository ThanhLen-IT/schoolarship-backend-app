-- Schema only, derived from Database-v1.0; no personal data.
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.app_events (
    id bigint NOT NULL,
    event_name character varying(100) NOT NULL,
    user_id integer,
    session_id uuid NOT NULL,
    scholarship_id integer,
    properties jsonb,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.app_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.app_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    sender_id integer NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.chat_messages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.comments (
    id integer NOT NULL,
    post_id integer NOT NULL,
    user_id integer NOT NULL,
    parent_id integer,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.comments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.conversations (
    id integer NOT NULL,
    user1_id integer NOT NULL,
    user2_id integer NOT NULL,
    last_message text,
    last_message_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT conversations_check CHECK ((user1_id < user2_id))
);

ALTER TABLE public.conversations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.conversations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.mentee_applications (
    id integer NOT NULL,
    mentee_id integer NOT NULL,
    mentor_id integer NOT NULL,
    scholarship_id integer,
    cv_file_url text NOT NULL,
    introduction text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.mentee_applications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mentee_applications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.mentor_reviews (
    id integer NOT NULL,
    mentor_id integer NOT NULL,
    mentee_id integer NOT NULL,
    application_id integer NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT mentor_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

ALTER TABLE public.mentor_reviews ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mentor_reviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.mentor_verifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    evidence_file_url text NOT NULL,
    scholarship_id integer,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    admin_note text,
    hourly_rate numeric(12,2),
    calendly_link text,
    qr_payment_url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.mentor_verifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mentor_verifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(255) NOT NULL,
    content text,
    type character varying(50),
    reference_id integer,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.post_likes (
    post_id integer NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.posts (
    id integer NOT NULL,
    author_id integer NOT NULL,
    scholarship_id integer,
    title character varying(255) NOT NULL,
    content text NOT NULL,
    image_url text,
    like_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.posts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.posts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.saved_scholarships (
    user_id integer NOT NULL,
    scholarship_id integer NOT NULL,
    saved_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.scholarship_crawl_logs (
    id bigint NOT NULL,
    source_name character varying(150),
    source_url text,
    started_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    finished_at timestamp without time zone,
    found_count integer DEFAULT 0,
    saved_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    status character varying(20) DEFAULT 'running'::character varying,
    error_message text
);

CREATE SEQUENCE public.scholarship_crawl_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.scholarship_crawl_logs_id_seq OWNED BY public.scholarship_crawl_logs.id;

CREATE TABLE public.scholarships (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    organization character varying(255),
    country character varying(100),
    continent character varying(100),
    type character varying(100),
    deadline date,
    description text,
    requirements text,
    benefits text,
    application_link text,
    image_url text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    source_url text,
    crawled_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reviewed_by integer,
    reviewed_at timestamp without time zone,
    rejection_reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    majors text[],
    study_levels text[] DEFAULT ARRAY['unknown'::text] NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    published_at timestamp without time zone,
    source_name character varying(150),
    original_content_html text,
    content_html text
);

COMMENT ON COLUMN public.scholarships.original_content_html IS 'Original article HTML collected from the source website';

COMMENT ON COLUMN public.scholarships.content_html IS 'Sanitized and editable HTML content displayed in the mobile application';

ALTER TABLE public.scholarships ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scholarships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.support_tickets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    subject character varying(255) NOT NULL,
    message text NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    admin_response text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at timestamp without time zone
);

ALTER TABLE public.support_tickets ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.support_tickets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.transactions (
    id integer NOT NULL,
    application_id integer,
    mentee_id integer NOT NULL,
    mentor_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    payment_method character varying(50),
    transaction_code character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT transactions_amount_check CHECK ((amount >= (0)::numeric))
);

ALTER TABLE public.transactions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(100) NOT NULL,
    university character varying(150),
    avatar_url text,
    bio text,
    skills text[],
    role character varying(30) DEFAULT 'user'::character varying NOT NULL,
    is_mentor boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    xp_points integer DEFAULT 0 NOT NULL,
    streak_count integer DEFAULT 0 NOT NULL,
    reset_password_token character varying(255),
    reset_password_expires timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    major character varying(150),
    username character varying(30),
    CONSTRAINT chk_users_username_format CHECK (((username IS NULL) OR ((username)::text ~ '^[a-z0-9_]{3,30}$'::text)))
);

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.scholarship_crawl_logs ALTER COLUMN id SET DEFAULT nextval('public.scholarship_crawl_logs_id_seq'::regclass);

ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user1_id_user2_id_key UNIQUE (user1_id, user2_id);

ALTER TABLE ONLY public.mentee_applications
    ADD CONSTRAINT mentee_applications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mentor_reviews
    ADD CONSTRAINT mentor_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mentor_verifications
    ADD CONSTRAINT mentor_verifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_pkey PRIMARY KEY (post_id, user_id);

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.saved_scholarships
    ADD CONSTRAINT saved_scholarships_pkey PRIMARY KEY (user_id, scholarship_id);

ALTER TABLE ONLY public.scholarship_crawl_logs
    ADD CONSTRAINT scholarship_crawl_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.scholarships
    ADD CONSTRAINT scholarships_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_transaction_code_key UNIQUE (transaction_code);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX idx_app_events_event_time ON public.app_events USING btree (event_name, occurred_at);

CREATE INDEX idx_app_events_occurred_at ON public.app_events USING btree (occurred_at);

CREATE INDEX idx_app_events_scholarship_time ON public.app_events USING btree (scholarship_id, occurred_at);

CREATE INDEX idx_app_events_session_id ON public.app_events USING btree (session_id);

CREATE INDEX idx_app_events_user_time ON public.app_events USING btree (user_id, occurred_at);

CREATE INDEX idx_mentee_app_status ON public.mentee_applications USING btree (status);

CREATE INDEX idx_mentor_verif_status ON public.mentor_verifications USING btree (status);

CREATE INDEX idx_posts_created_at ON public.posts USING btree (created_at);

CREATE INDEX idx_scholarships_deadline ON public.scholarships USING btree (deadline);

CREATE INDEX idx_scholarships_majors ON public.scholarships USING gin (majors);

CREATE INDEX idx_scholarships_status ON public.scholarships USING btree (status);

CREATE INDEX idx_scholarships_status_deadline ON public.scholarships USING btree (status, deadline);

CREATE INDEX idx_scholarships_study_levels ON public.scholarships USING gin (study_levels);

CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status);

CREATE INDEX idx_transactions_status ON public.transactions USING btree (status);

CREATE INDEX idx_users_created_at ON public.users USING btree (created_at);

CREATE INDEX idx_users_role ON public.users USING btree (role);

CREATE UNIQUE INDEX uq_scholarships_source_url ON public.scholarships USING btree (source_url);

CREATE UNIQUE INDEX uq_users_username_lower ON public.users USING btree (lower((username)::text)) WHERE (username IS NOT NULL);

ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_scholarship_id_fkey FOREIGN KEY (scholarship_id) REFERENCES public.scholarships(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.comments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user1_id_fkey FOREIGN KEY (user1_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user2_id_fkey FOREIGN KEY (user2_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mentee_applications
    ADD CONSTRAINT mentee_applications_mentee_id_fkey FOREIGN KEY (mentee_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.mentee_applications
    ADD CONSTRAINT mentee_applications_mentor_id_fkey FOREIGN KEY (mentor_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.mentee_applications
    ADD CONSTRAINT mentee_applications_scholarship_id_fkey FOREIGN KEY (scholarship_id) REFERENCES public.scholarships(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.mentor_reviews
    ADD CONSTRAINT mentor_reviews_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.mentee_applications(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.mentor_reviews
    ADD CONSTRAINT mentor_reviews_mentee_id_fkey FOREIGN KEY (mentee_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.mentor_reviews
    ADD CONSTRAINT mentor_reviews_mentor_id_fkey FOREIGN KEY (mentor_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.mentor_verifications
    ADD CONSTRAINT mentor_verifications_scholarship_id_fkey FOREIGN KEY (scholarship_id) REFERENCES public.scholarships(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.mentor_verifications
    ADD CONSTRAINT mentor_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_scholarship_id_fkey FOREIGN KEY (scholarship_id) REFERENCES public.scholarships(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.saved_scholarships
    ADD CONSTRAINT saved_scholarships_scholarship_id_fkey FOREIGN KEY (scholarship_id) REFERENCES public.scholarships(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.saved_scholarships
    ADD CONSTRAINT saved_scholarships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.scholarships
    ADD CONSTRAINT scholarships_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.mentee_applications(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_mentee_id_fkey FOREIGN KEY (mentee_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_mentor_id_fkey FOREIGN KEY (mentor_id) REFERENCES public.users(id) ON DELETE RESTRICT;
