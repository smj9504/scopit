/**
 * Scopit - Support Service
 * Messages a signed-in user sends to the Scopit team from the Help form.
 */
import api from './api';

export type InquiryCategory = 'question' | 'problem' | 'idea' | 'other';

export interface InquiryCreated {
  id: string;
  /** Where the team's reply will go (the account email). */
  replyTo: string;
  createdAt: string;
}

export const supportService = {
  sendInquiry: async (input: {
    category: InquiryCategory;
    message: string;
    /** In-app path the user is on, so the team can see what they see. */
    pageUrl?: string;
  }): Promise<InquiryCreated> => {
    const { data } = await api.post('/support/inquiries', {
      category: input.category,
      message: input.message,
      page_url: input.pageUrl,
    });
    return { id: data.id, replyTo: data.reply_to, createdAt: data.created_at };
  },
};

export default supportService;
