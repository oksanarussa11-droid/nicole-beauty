import { sbSelect } from './supabase';

export type Master = {
  id: number;
  name: string;
  specialty: string | null;
  bio: string | null;
  photo_url: string | null;
  display_order: number;
  is_public: boolean;
  active: boolean;
  created_at: string;
};

export type Service = {
  id: number;
  name: string;
  created_at?: string;
};

export type MasterService = {
  id: number;
  master_id: number;
  service_id: number;
  price: number;
  commission_master_pct?: number;
  commission_master_pct_salon?: number;
};

export type ServicePrice = {
  service: Service;
  from: number | null;
};

export async function getPublicMasters(): Promise<Master[]> {
  return sbSelect<Master[]>('masters_public?is_public=eq.true&active=eq.true&order=display_order.asc,name.asc');
}

export async function getServices(): Promise<Service[]> {
  return sbSelect<Service[]>('services?select=*');
}

export async function getMasterServices(): Promise<MasterService[]> {
  return sbSelect<MasterService[]>('master_services?select=*');
}

export function servicePrices(services: Service[], ms: MasterService[], publicMasterIds: number[]): ServicePrice[] {
  return services.map(s => {
    const masterPrices = ms
      .filter(m => m.service_id === s.id && publicMasterIds.includes(m.master_id) && Number(m.price) > 0)
      .map(m => Number(m.price));

    const minPrice = masterPrices.length > 0 ? Math.min(...masterPrices) : null;
    return { service: s, from: minPrice };
  });
}
