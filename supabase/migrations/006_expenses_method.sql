-- Add payment method column to expenses table
alter table expenses add column if not exists method text;