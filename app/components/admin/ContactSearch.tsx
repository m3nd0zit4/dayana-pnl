"use client";

import SmartContactSearch from "@/app/components/admin/crm/SmartContactSearch";

const ContactSearch = ({ initialQ = "" }: { initialQ?: string }) => (
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
    <SmartContactSearch initialQ={initialQ} />
  </div>
);

export default ContactSearch;
