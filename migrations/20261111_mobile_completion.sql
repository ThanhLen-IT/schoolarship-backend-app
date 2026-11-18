-- Additive mobile features. Apply after 20261110_midterm_mentor_ranking.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS public.conversations (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user1_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 user2_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 last_message text, last_message_at timestamp, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(user1_id < user2_id), UNIQUE(user1_id,user2_id)
);
CREATE TABLE IF NOT EXISTS public.chat_messages (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id integer NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 sender_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 message text NOT NULL, is_read boolean NOT NULL DEFAULT false,
 created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS client_message_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS chat_message_idempotency
 ON public.chat_messages(conversation_id,sender_id,client_message_id);
CREATE INDEX IF NOT EXISTS chat_message_cursor ON public.chat_messages(conversation_id,id DESC);
CREATE TABLE IF NOT EXISTS public.notifications (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 title varchar(255) NOT NULL, content text, type varchar(50), reference_id integer,
 is_read boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS mobile_notification_owner ON public.notifications(user_id,id DESC);
CREATE TABLE IF NOT EXISTS public.support_tickets (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 subject varchar(255) NOT NULL, message text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'open', admin_response text,
 created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at timestamp
);
CREATE OR REPLACE FUNCTION public.notify_mobile_mentoring() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient integer; notification_title text;
BEGIN
 IF TG_TABLE_NAME = 'mentee_applications' THEN
  IF TG_OP = 'INSERT' THEN
   recipient := NEW.mentor_id; notification_title := 'Có hồ sơ mentoring mới';
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
   recipient := CASE WHEN NEW.status = 'completed' OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.mentee_id AND is_active) THEN NEW.mentor_id ELSE NEW.mentee_id END;
   notification_title := 'Hồ sơ mentoring đã cập nhật';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO public.notifications(user_id,title,content,type,reference_id)
   SELECT recipient, notification_title, 'Mở hồ sơ để xem tiến độ mới nhất.', 'mentoring', NEW.id
   WHERE EXISTS(SELECT 1 FROM public.users WHERE id=recipient AND is_active);
 ELSIF TG_TABLE_NAME = 'mentor_verifications' AND OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status IN ('approved','rejected') THEN
  INSERT INTO public.notifications(user_id,title,content,type,reference_id)
   SELECT NEW.user_id, 'Kết quả xét duyệt Mentor', 'Hồ sơ xét duyệt của bạn đã có kết quả.', 'verification', NEW.scholarship_id
   WHERE EXISTS(SELECT 1 FROM public.users WHERE id=NEW.user_id AND is_active);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mobile_application_notification ON public.mentee_applications;
CREATE TRIGGER mobile_application_notification AFTER INSERT OR UPDATE OF status
 ON public.mentee_applications FOR EACH ROW EXECUTE FUNCTION public.notify_mobile_mentoring();
DROP TRIGGER IF EXISTS mobile_verification_notification ON public.mentor_verifications;
CREATE TRIGGER mobile_verification_notification AFTER UPDATE OF status
 ON public.mentor_verifications FOR EACH ROW EXECUTE FUNCTION public.notify_mobile_mentoring();
COMMIT;
