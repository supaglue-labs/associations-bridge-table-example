import { Inngest } from 'inngest';
import { serve } from 'inngest/next';
import prisma from '../../lib/prisma';
import { SupaglueClient } from '../../lib/supaglue';

type PassthroughResponse = {
  url: string;
  status: number;
  headers: Record<string, any>;
  body: {
    results: HubspotRecord[];
    paging?: {
      next?: {
        after?: string;
        link: string;
      };
    };
  };
};

type HubspotRecord = {
  id: string;
  properties: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  associations?: {
    companies?: {
      results: HubspotAssociation[];
    };
  };
};

type HubspotAssociation = {
  id: string;
  type: string;
};

const SUPAGLUE_BASE_URL = process.env.SUPAGLUE_BASE_URL;
const SUPAGLUE_API_KEY = process.env.SUPAGLUE_API_KEY;
const CUSTOMER_ID = process.env.CUSTOMER_ID;
const PROVIDER_NAME = process.env.PROVIDER_NAME;

// Create a client to send and receive events
export const inngest = new Inngest({ name: 'My App' });

const transformedSyncedData = inngest.createFunction(
  { name: 'Sync contact to company associations' },
  { cron: 'TZ=US/Pacific 49 * * * *' }, // Once an hour
  async ({ step }) => {
    const startTime = new Date();
    await handleAllPages();
    const endTime = new Date();
    return {
      body: 'Successfully copied associations in ' + (endTime.getTime() - startTime.getTime()) + 'ms',
    };
  },
);

// Create an API that serves zero functions
export default serve(inngest, [transformedSyncedData]);

const handleAllPages = async () => {
  let cursor: string | undefined;
  do {
    cursor = await handleSinglePage(cursor);
  } while (cursor);
};

const handleSinglePage = async (cursor?: string): Promise<string | undefined> => {
  console.log(`handling single page with cursor ${cursor}`);
  const client = new SupaglueClient(SUPAGLUE_BASE_URL, SUPAGLUE_API_KEY);
  const response = await client.passthrough<PassthroughResponse>({
    path: '/crm/v3/objects/contacts',
    method: 'GET',
    query: {
      after: cursor,
      limit: '100',
      associations: 'company',
    },
    customerId: CUSTOMER_ID,
    providerName: PROVIDER_NAME,
  });
  const allContactIds = response.body.results.map((contact) => contact.id);
  const count = await prisma.$transaction(
    async (tx) => {
      await tx.contactToAccount.deleteMany({
        where: {
          contactId: {
            in: allContactIds,
          },
          customerId: CUSTOMER_ID,
        },
      });
      const { count } = await tx.contactToAccount.createMany({
        data: response.body.results.flatMap((contact) => {
          if (!contact.associations?.companies) {
            return [];
          }
          return contact.associations.companies.results.flatMap((company) => {
            return {
              customerId: CUSTOMER_ID,
              contactId: contact.id,
              accountId: company.id,
              metadata: {
                type: company.type,
              },
              lastModifiedAt: new Date(),
            };
          });
        }),
      });
      return count;
    },
    {
      maxWait: 5000, // default: 2000
      timeout: 10000, // default: 5000
    },
  );

  console.log(`Upserted ${count} records`);
  console.log(`response.paging: ${JSON.stringify(response.body?.paging, null, 2)}`);

  return response.body.paging?.next?.after;
};

const handleSingleContact = async (contact: HubspotRecord) => {
  console.log(`Handling contact ${contact.id}`, contact);
  await prisma.$transaction(
    async (tx) => {
      await tx.contactToAccount.deleteMany({
        where: {
          contactId: contact.id,
        },
      });
      if (contact.associations?.companies?.results.length) {
        await tx.contactToAccount.createMany({
          data: contact.associations.companies.results.map((company) => ({
            customerId: CUSTOMER_ID,
            contactId: contact.id,
            accountId: company.id,
            metadata: {
              type: company.type,
            },
            lastModifiedAt: new Date(),
          })),
        });
      }
    },
    {
      maxWait: 5000, // default: 2000
      timeout: 10000, // default: 5000
    },
  );
};
