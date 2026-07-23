CREATE TABLE IF NOT EXISTS marketplace_registration_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_code varchar(100) NOT NULL,
  common_category varchar(200),
  brand varchar(200),
  manufacturer varchar(200),
  country_of_origin varchar(120),
  certification text,
  detail_notice jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_product_url text,
  primary_image_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_code)
);
CREATE TABLE IF NOT EXISTS marketplace_registration_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES marketplace_registration_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  marketplace_id varchar(50) NOT NULL,
  category_id varchar(200),
  category_name text,
  status varchar(30) NOT NULL DEFAULT 'ready',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id, marketplace_id)
);
