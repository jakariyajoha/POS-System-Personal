-- ==========================================
-- SUPABASE SCHEMA SETUP FOR FINANCELY
-- Copy and run this script in your Supabase SQL Editor
-- ==========================================

-- 1. Create profiles table
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  full_name text,
  avatar_url text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Create categories table
create table if not exists public.categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  icon_name text not null,
  color text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Create transactions table
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  amount decimal not null,
  type text check (type in ('income', 'expense')) not null,
  category text not null,
  date timestamp with time zone not null,
  note text,
  tags text[],
  recurring_id uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Create recurring_transactions table
create table if not exists public.recurring_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  amount decimal not null,
  type text check (type in ('income', 'expense')) not null,
  category text not null,
  note text,
  tags text[],
  frequency text check (frequency in ('daily', 'weekly', 'monthly', 'yearly')) not null,
  start_date timestamp with time zone not null,
  next_date timestamp with time zone not null,
  end_date timestamp with time zone,
  last_processed timestamp with time zone,
  active boolean default true not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Create loans table
create table if not exists public.loans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  person_name text not null,
  amount decimal not null,
  remaining_amount decimal not null,
  type text check (type in ('lend', 'borrow')) not null,
  due_date timestamp with time zone,
  note text,
  status text check (status in ('active', 'completed')) default 'active' not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Create loan_payments table
create table if not exists public.loan_payments (
  id uuid default gen_random_uuid() primary key,
  loan_id uuid references public.loans on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  amount decimal not null,
  payment_date timestamp with time zone default timezone('utc'::text, now()) not null,
  note text
);

-- 7. Enable Row-Level Security (RLS) on all tables
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.loans enable row level security;
alter table public.loan_payments enable row level security;

-- 8. Create Security Policies
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "Users can manage own categories" on public.categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own transactions" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own recurring" on public.recurring_transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own loans" on public.loans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own payments" on public.loan_payments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 9. Setup trigger for automatic profiles on auth registration
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
