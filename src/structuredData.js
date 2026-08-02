const SITE_URL = "https://www.apres-school.co.uk";
const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const LOGO_URL = `${SITE_URL}/assets/apres-school-text.png`;
const HERO_IMAGE_URL = `${SITE_URL}/assets/apres-highlights/real-img_0043.jpg`;

const pageDefinitions = {
  Home: {
    path: "/",
    name: "Après School | Wraparound Care for Schools & Holiday Camps",
    description: "Wraparound care, holiday camps and extended school provision that helps schools strengthen their parent offer.",
    type: "WebPage",
  },
  "Holiday Clubs": {
    path: "/holiday-clubs",
    breadcrumb: "Holiday Clubs",
    name: "Holiday Clubs Across Five Venues | Après School",
    description: "Active, creative holiday clubs for primary-age children across five school venues.",
    type: "CollectionPage",
    service: {
      name: "Après School holiday clubs",
      serviceType: "School holiday childcare and activity clubs",
      audienceType: "Families seeking school holiday childcare for primary-age children",
    },
  },
  Wraparound: {
    path: "/wraparound",
    breadcrumb: "Wraparound Care",
    name: "Wraparound Care for Schools | Après School",
    description: "Breakfast clubs and after-school care for schools that want reliable extended provision parents trust.",
    type: "WebPage",
    service: {
      name: "Après School wraparound care",
      serviceType: "Breakfast clubs and after-school care",
      audienceType: "Families and schools seeking term-time wraparound childcare",
    },
  },
  Schools: {
    path: "/schools",
    breadcrumb: "School Partnerships",
    name: "Wraparound Care for Schools & Extended Provision | Après School",
    description: "Partner with Après School for wraparound care, holiday camps and extended provision that helps parents choose your school.",
    type: "WebPage",
    service: {
      name: "Après School partnership services",
      serviceType: "Managed wraparound care, holiday provision and extended school services",
      audienceType: "Schools seeking a childcare and extended-provision partner",
    },
  },
  Payments: {
    path: "/payments",
    breadcrumb: "Payments",
    name: "Payments & Vouchers | Après School",
    description: "Payment options, childcare vouchers and family-account guidance.",
    type: "WebPage",
  },
  Cancellations: {
    path: "/cancellations",
    breadcrumb: "Cancellations",
    name: "Cancellations & Amendments | Après School",
    description: "Guidance for amending or cancelling Après School bookings.",
    type: "WebPage",
  },
  Policies: {
    path: "/policies",
    breadcrumb: "Policies",
    name: "Policies | Après School",
    description: "Safeguarding, behaviour, health and safety, privacy and complaints policy summaries.",
    type: "WebPage",
  },
  Contact: {
    path: "/contact",
    breadcrumb: "Contact",
    name: "Contact Après School | Wraparound Care & Holiday Camps",
    description: "Contact Après School about wraparound care for schools, holiday camps, school partnerships and staffing.",
    type: "ContactPage",
  },
  "Staff Application": {
    path: "/staff-application",
    breadcrumb: "Staff Application",
    name: "Staff Application | Après School",
    description: "Apply to work with Après School through the staff onboarding form.",
    type: "WebPage",
  },
};

const pagesByPath = Object.fromEntries(Object.entries(pageDefinitions).map(([page, definition]) => [definition.path, page]));

function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: `${SITE_URL}/`,
    name: "Après School",
    inLanguage: "en-GB",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

function organizationNode() {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "Après School",
    legalName: "Après School Limited",
    url: `${SITE_URL}/`,
    email: "hello@apres-school.co.uk",
    foundingDate: "2023-06-14",
    description: "Provider of wraparound care, breakfast clubs, after-school care, holiday clubs and managed extended-school provision for families and partner schools.",
    logo: {
      "@type": "ImageObject",
      "@id": `${SITE_URL}/#logo`,
      url: LOGO_URL,
      contentUrl: LOGO_URL,
      width: 1025,
      height: 396,
      caption: "Après School",
    },
    image: {
      "@type": "ImageObject",
      "@id": `${SITE_URL}/#primaryimage`,
      url: HERO_IMAGE_URL,
      contentUrl: HERO_IMAGE_URL,
      width: 1600,
      height: 1200,
      caption: "Children taking part in an Après School activity",
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: "24 Cherry Orchard Road",
      addressLocality: "Bromley",
      addressRegion: "Kent",
      postalCode: "BR2 8NE",
      addressCountry: "GB",
    },
    identifier: {
      "@type": "PropertyValue",
      propertyID: "Companies House",
      value: "14934898",
      url: "https://find-and-update.company-information.service.gov.uk/company/14934898",
    },
    sameAs: ["https://find-and-update.company-information.service.gov.uk/company/14934898"],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "hello@apres-school.co.uk",
      areaServed: "GB",
      availableLanguage: "English",
    },
    areaServed: [
      { "@type": "AdministrativeArea", name: "London" },
      { "@type": "AdministrativeArea", name: "Surrey" },
    ],
    knowsAbout: [
      "Wraparound childcare",
      "Breakfast clubs",
      "After-school care",
      "School holiday clubs",
      "Extended school provision",
      "School partnerships",
    ],
    makesOffer: [
      {
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: "Wraparound care", serviceType: "Breakfast clubs and after-school care" },
      },
      {
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: "Holiday clubs", serviceType: "School holiday childcare and activity clubs" },
      },
      {
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: "School partnerships", serviceType: "Managed extended-school provision" },
      },
    ],
  };
}

function breadcrumbNode(definition) {
  const pageUrl = `${SITE_URL}${definition.path}`;
  return {
    "@type": "BreadcrumbList",
    "@id": `${pageUrl}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: definition.breadcrumb, item: pageUrl },
    ],
  };
}

function serviceNode(definition) {
  if (!definition.service) return null;
  const pageUrl = `${SITE_URL}${definition.path}`;
  return {
    "@type": "Service",
    "@id": `${pageUrl}#service`,
    name: definition.service.name,
    serviceType: definition.service.serviceType,
    description: definition.description,
    url: pageUrl,
    provider: { "@id": ORGANIZATION_ID },
    areaServed: [
      { "@type": "AdministrativeArea", name: "London" },
      { "@type": "AdministrativeArea", name: "Surrey" },
    ],
    audience: { "@type": "Audience", audienceType: definition.service.audienceType },
  };
}

export function structuredDataForPage(page) {
  const definition = pageDefinitions[page];
  if (!definition) return null;
  const pageUrl = `${SITE_URL}${definition.path}`;
  const pageNode = {
    "@type": definition.type,
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name: definition.name,
    description: definition.description,
    inLanguage: "en-GB",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORGANIZATION_ID },
  };

  if (page === "Home") {
    pageNode.primaryImageOfPage = { "@id": `${SITE_URL}/#primaryimage` };
    return { "@context": "https://schema.org", "@graph": [organizationNode(), websiteNode(), pageNode] };
  }

  const breadcrumb = breadcrumbNode(definition);
  pageNode.breadcrumb = { "@id": breadcrumb["@id"] };
  const service = serviceNode(definition);
  if (service) pageNode.mainEntity = { "@id": service["@id"] };
  return {
    "@context": "https://schema.org",
    "@graph": [websiteNode(), pageNode, breadcrumb, ...(service ? [service] : [])],
  };
}

export function structuredDataForPath(pathname) {
  const normalized = String(pathname || "/").replace(/\/+$/, "") || "/";
  const page = pagesByPath[normalized];
  return page ? structuredDataForPage(page) : null;
}

export function serializeStructuredData(data) {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

