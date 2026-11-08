import type { ToolDefinition } from "eve/tools";
import type { ToolName } from "@/agent/lib/catalog";
import convertEventTimezone from "@/agent/lib/tools/convert_event_timezone";
import createCalendarEvent from "@/agent/lib/tools/create_calendar_event";
import createContact from "@/agent/lib/tools/create_contact";
import createPromoCode from "@/agent/lib/tools/create_promo_code";
import createStaffUser from "@/agent/lib/tools/create_staff_user";
import createTherapyEnrollment from "@/agent/lib/tools/create_therapy_enrollment";
import createWorkshop from "@/agent/lib/tools/create_workshop";
import createWorkshopProduct from "@/agent/lib/tools/create_workshop_product";
import crmStats from "@/agent/lib/tools/crm_stats";
import dashboardStats from "@/agent/lib/tools/dashboard_stats";
import deactivateFreeWebinar from "@/agent/lib/tools/deactivate_free_webinar";
import draftConversationReply from "@/agent/lib/tools/draft_conversation_reply";
import getContact from "@/agent/lib/tools/get_contact";
import getConversation from "@/agent/lib/tools/get_conversation";
import getEnrollment from "@/agent/lib/tools/get_enrollment";
import getFreeWebinar from "@/agent/lib/tools/get_free_webinar";
import getPayment from "@/agent/lib/tools/get_payment";
import getWorkshopEdition from "@/agent/lib/tools/get_workshop_edition";
import importGoogleContact from "@/agent/lib/tools/import_google_contact";
import linkConversationToContact from "@/agent/lib/tools/link_conversation_to_contact";
import listAiRuns from "@/agent/lib/tools/list_ai_runs";
import listAppointments from "@/agent/lib/tools/list_appointments";
import listCalendarEvents from "@/agent/lib/tools/list_calendar_events";
import listConversations from "@/agent/lib/tools/list_conversations";
import listEnrollments from "@/agent/lib/tools/list_enrollments";
import listFreeEventRegistrations from "@/agent/lib/tools/list_free_event_registrations";
import listGoogleAccounts from "@/agent/lib/tools/list_google_accounts";
import listMessageTemplates from "@/agent/lib/tools/list_message_templates";
import listNotifications from "@/agent/lib/tools/list_notifications";
import listPaymentReceipts from "@/agent/lib/tools/list_payment_receipts";
import listPayments from "@/agent/lib/tools/list_payments";
import listProducts from "@/agent/lib/tools/list_products";
import listWhatsappMessages from "@/agent/lib/tools/list_whatsapp_messages";
import listWorkshopDocuments from "@/agent/lib/tools/list_workshop_documents";
import listWorkshopEditions from "@/agent/lib/tools/list_workshop_editions";
import listWorkshopEnrollees from "@/agent/lib/tools/list_workshop_enrollees";
import memory from "@/agent/lib/tools/memory";
import messageOwner from "@/agent/lib/tools/message_owner";
import callOwner from "@/agent/lib/tools/call_owner";
import sendOwnerVoiceNote from "@/agent/lib/tools/send_owner_voice_note";
import pendingTasks from "@/agent/lib/tools/pending_tasks";
import prepareCustomerWhatsappMessage from "@/agent/lib/tools/prepare_customer_whatsapp_message";
import queryAuditLog from "@/agent/lib/tools/query_audit_log";
import recordManualPayment from "@/agent/lib/tools/record_manual_payment";
import requestPaymentOtp from "@/agent/lib/tools/request_payment_otp";
import searchContacts from "@/agent/lib/tools/search_contacts";
import searchGoogleContacts from "@/agent/lib/tools/search_google_contacts";
import sendBulkEmail from "@/agent/lib/tools/send_bulk_email";
import sendContactEmail from "@/agent/lib/tools/send_contact_email";
import sendContactSms from "@/agent/lib/tools/send_contact_sms";
import sendContactTemplateEmail from "@/agent/lib/tools/send_contact_template_email";
import sendWhatsappBulk from "@/agent/lib/tools/send_whatsapp_bulk";
import sendWhatsappToContact from "@/agent/lib/tools/send_whatsapp_to_contact";
import updateCalendarEvent from "@/agent/lib/tools/update_calendar_event";
import updateFreeWebinar from "@/agent/lib/tools/update_free_webinar";
import updateProductPrice from "@/agent/lib/tools/update_product_price";
import updatePromoCode from "@/agent/lib/tools/update_promo_code";
import updateUsdToCopRate from "@/agent/lib/tools/update_usd_to_cop_rate";
import updateWorkshop from "@/agent/lib/tools/update_workshop";
import uploadDriveFile from "@/agent/lib/tools/upload_drive_file";
import whatsappAiStatus from "@/agent/lib/tools/whatsapp_ai_status";
import whatsappFindChat from "@/agent/lib/tools/whatsapp_find_chat";
import whatsappGetConfig from "@/agent/lib/tools/whatsapp_get_config";
import whatsappListPlaybooks from "@/agent/lib/tools/whatsapp_list_playbooks";
import whatsappSavePlaybook from "@/agent/lib/tools/whatsapp_save_playbook";
import whatsappSetChat from "@/agent/lib/tools/whatsapp_set_chat";
import whatsappSimulateReply from "@/agent/lib/tools/whatsapp_simulate_reply";
import whatsappUpdateConfig from "@/agent/lib/tools/whatsapp_update_config";

/**
 * Every CRM tool definition by name. The tool files live in `agent/lib/tools/`
 * (not `agent/tools/`) so eve does not hand all of them to every agent: each
 * agent gets its own subset from `agent/lib/catalog.ts` through the dynamic
 * resolvers in `agent/tools/crm.ts` and `agent/subagents/<id>/tools/crm.ts`. The
 * MCP server reads the same map. `satisfies` makes the catalog and this map
 * fail typecheck the moment they disagree.
 */
export const TOOL_DEFINITIONS = {
  convert_event_timezone: convertEventTimezone,
  create_calendar_event: createCalendarEvent,
  create_contact: createContact,
  create_promo_code: createPromoCode,
  create_staff_user: createStaffUser,
  create_therapy_enrollment: createTherapyEnrollment,
  create_workshop: createWorkshop,
  create_workshop_product: createWorkshopProduct,
  crm_stats: crmStats,
  dashboard_stats: dashboardStats,
  deactivate_free_webinar: deactivateFreeWebinar,
  draft_conversation_reply: draftConversationReply,
  get_contact: getContact,
  get_conversation: getConversation,
  get_enrollment: getEnrollment,
  get_free_webinar: getFreeWebinar,
  get_payment: getPayment,
  get_workshop_edition: getWorkshopEdition,
  import_google_contact: importGoogleContact,
  link_conversation_to_contact: linkConversationToContact,
  list_ai_runs: listAiRuns,
  list_appointments: listAppointments,
  list_calendar_events: listCalendarEvents,
  list_conversations: listConversations,
  list_enrollments: listEnrollments,
  list_free_event_registrations: listFreeEventRegistrations,
  list_google_accounts: listGoogleAccounts,
  list_message_templates: listMessageTemplates,
  list_notifications: listNotifications,
  list_payment_receipts: listPaymentReceipts,
  list_payments: listPayments,
  list_products: listProducts,
  list_whatsapp_messages: listWhatsappMessages,
  list_workshop_documents: listWorkshopDocuments,
  list_workshop_editions: listWorkshopEditions,
  list_workshop_enrollees: listWorkshopEnrollees,
  memory: memory,
  message_owner: messageOwner,
  send_owner_voice_note: sendOwnerVoiceNote,
  call_owner: callOwner,
  pending_tasks: pendingTasks,
  prepare_customer_whatsapp_message: prepareCustomerWhatsappMessage,
  query_audit_log: queryAuditLog,
  record_manual_payment: recordManualPayment,
  request_payment_otp: requestPaymentOtp,
  search_contacts: searchContacts,
  search_google_contacts: searchGoogleContacts,
  send_bulk_email: sendBulkEmail,
  send_contact_email: sendContactEmail,
  send_contact_sms: sendContactSms,
  send_contact_template_email: sendContactTemplateEmail,
  send_whatsapp_bulk: sendWhatsappBulk,
  send_whatsapp_to_contact: sendWhatsappToContact,
  update_calendar_event: updateCalendarEvent,
  update_free_webinar: updateFreeWebinar,
  update_product_price: updateProductPrice,
  update_promo_code: updatePromoCode,
  update_usd_to_cop_rate: updateUsdToCopRate,
  update_workshop: updateWorkshop,
  upload_drive_file: uploadDriveFile,
  whatsapp_ai_status: whatsappAiStatus,
  whatsapp_find_chat: whatsappFindChat,
  whatsapp_get_config: whatsappGetConfig,
  whatsapp_list_playbooks: whatsappListPlaybooks,
  whatsapp_save_playbook: whatsappSavePlaybook,
  whatsapp_set_chat: whatsappSetChat,
  whatsapp_simulate_reply: whatsappSimulateReply,
  whatsapp_update_config: whatsappUpdateConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<ToolName, ToolDefinition<any, any>>;

/**
 * One definition with its input type erased. The map above is a union of 65
 * input shapes; code that handles any tool by name (the dynamic resolvers, the
 * MCP server) only passes inputs through, and each tool validates its own.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolDefinition = (name: ToolName): ToolDefinition<any, any> => TOOL_DEFINITIONS[name];
