import nodemailer from 'nodemailer';
import { Notification } from '../types/notification';

export class EmailService {
  private static transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  static async sendNotificationEmail(
    userEmail: string,
    notification: Notification
  ): Promise<void> {
    try {
      const emailTemplate = this.getEmailTemplate(notification);

      await this.transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: userEmail,
        subject: emailTemplate.subject,
        html: emailTemplate.html
      });
    } catch (error) {
      console.error('Error sending notification email:', error);
      // Don't throw the error - we don't want to break the notification flow
      // if email sending fails
    }
  }

  private static getEmailTemplate(notification: Notification): {
    subject: string;
    html: string;
  } {
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const projectUrl = `${baseUrl}/projects/${notification.projectId}`;

    let subject = 'Condo Project Update';
    let content = '';

    switch (notification.type) {
      case 'status_update':
        subject = 'Project Status Update';
        content = `The status of a project you're involved in has been updated.`;
        break;
      case 'new_vote':
        subject = 'New Vote on Project';
        content = `A new vote has been cast on your project.`;
        break;
      case 'new_comment':
        subject = 'New Comment on Project';
        content = `A new comment has been added to a project you're following.`;
        break;
      case 'vote_threshold':
        subject = 'Voting Threshold Reached';
        content = `A voting threshold has been reached on your project.`;
        break;
    }

    return {
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">${subject}</h2>
          <p style="color: #666; font-size: 16px;">${notification.message}</p>
          <p style="color: #666; font-size: 16px;">${content}</p>
          <div style="margin: 30px 0;">
            <a href="${projectUrl}" 
               style="background-color: #4CAF50; color: white; padding: 12px 20px; 
                      text-decoration: none; border-radius: 4px;">
              View Project
            </a>
          </div>
          <p style="color: #999; font-size: 12px;">
            You received this email because you're involved in a condo project. 
            You can manage your notification preferences in your account settings.
          </p>
        </div>
      `
    };
  }
} 