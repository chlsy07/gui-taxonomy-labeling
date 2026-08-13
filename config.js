/* Supabase connection for the labeling site.
 *
 * Fill these in after running labeling/supabase_schema.sql in your Supabase
 * project (Project Settings -> API). The anon key is a PUBLIC key and is meant
 * to ship in the page; row level security is what protects the data — anon can
 * only INSERT labels and read aggregate counts, never read anyone's labels.
 *
 * Leave them empty to run the site in local-only mode: labels are kept in the
 * browser and recovered with the 내보내기 button.
 */
window.LABELING_CONFIG = {
  supabaseUrl: 'https://spnhagrwxbxvzavgvcsd.supabase.co',      // project URL only — /rest/v1 is added by the app
  supabaseAnonKey: 'sb_publishable_fehASbNo1XORRqpAhSEQ1g_KBU71P7n',  // publishable (public) key, not the secret key
};
