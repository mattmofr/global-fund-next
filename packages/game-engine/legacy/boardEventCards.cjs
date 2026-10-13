'use strict';

// Cartes Événement du plateau. Les récits de marché sont fictifs; les effets
// mécaniques restent définis par les champs de chaque carte.
const BOARD_EVENT_CARDS = [
  {
    "id": "board-01",
    "title": "Contrat public inattendu",
    "story": "Une opération de financement liée à {company} se conclut par une indemnité versée au fonds actif.",
    "effect": "cash",
    "activeCash": 2,
    "balanceCategory": "favorable",
    "targetSector": "finance"
  },
  {
    "id": "board-02",
    "title": "Prime de fidélité bancaire",
    "story": "Une banque du secteur de {company} distribue une prime ponctuelle de 2 M€ par titre détenu.",
    "effect": "dividend",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "finance",
    "amount": 2
  },
  {
    "id": "board-03",
    "title": "Rachat stratégique",
    "story": "Un partenaire industriel rachète chaque titre détenu de {company} au cours du marché, avec une prime de 2 M€ par titre.",
    "effect": "buyback",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "industry",
    "amount": 2
  },
  {
    "id": "board-04",
    "title": "Crédit d’innovation",
    "story": "Un crédit d’innovation est versé au fonds actif à la suite d’un programme de recherche coté.",
    "effect": "cash",
    "activeCash": 1,
    "balanceCategory": "favorable"
  },
  {
    "id": "board-05",
    "title": "Dividende exceptionnel",
    "story": "Après la cession d’un actif énergétique lié à {company}, une distribution ponctuelle de 2 M€ par titre est versée.",
    "effect": "dividend",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "energy",
    "amount": 2
  },
  {
    "id": "board-06",
    "title": "Commande humanitaire",
    "story": "La commande humanitaire concernant {company} reste à l’étude; aucun versement ni coût ne s’applique pour le moment.",
    "effect": "cash",
    "activeCash": 0,
    "balanceCategory": "mixed"
  },
  {
    "id": "board-07",
    "title": "Offre de retrait",
    "story": "Un investisseur rachète chaque titre détenu de {company} au cours du marché, avec une prime de 2 M€ par titre.",
    "effect": "buyback",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "realestate",
    "amount": 2
  },
  {
    "id": "board-08",
    "title": "Brevet décisif",
    "story": "Une licence de brevet liée à {company} ouvre un nouveau débouché; les porteurs reçoivent 2 M€ par titre.",
    "effect": "dividend",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "technology",
    "amount": 2
  },
  {
    "id": "board-09",
    "title": "Amende de conformité",
    "story": "Un défaut de conformité dans les activités de santé liées à {company} entraîne des frais de 1 M€ par titre détenu.",
    "effect": "fine",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "health",
    "amount": 1
  },
  {
    "id": "board-10",
    "title": "Rappel de sécurité",
    "story": "Un rappel de sécurité sur un équipement de {company} entraîne 2 M€ de frais par titre détenu.",
    "effect": "fine",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "industry",
    "amount": 2
  },
  {
    "id": "board-11",
    "title": "Taxe carbone accélérée",
    "story": "Une taxe carbone accélérée sur les activités de {company} entraîne 1 M€ de frais par titre détenu.",
    "effect": "fine",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "energy",
    "amount": 1
  },
  {
    "id": "board-12",
    "title": "Frais de restructuration",
    "story": "La restructuration des activités de {company} entraîne 1 M€ de frais par titre détenu.",
    "effect": "fine",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "media",
    "amount": 1
  },
  {
    "id": "board-13",
    "title": "Vente réglementaire",
    "story": "Une règle prudentielle plafonne les détentions dominantes autour de {company}; le fonds actif reçoit 1 M€ et les monopoles immobiliers cèdent une action par société concernée.",
    "effect": "regulation",
    "activeCash": 1,
    "balanceCategory": "mixed",
    "targetSector": "realestate",
    "quantity": 1
  },
  {
    "id": "board-14",
    "title": "Désengagement d’un assureur",
    "story": "Un assureur réduit son exposition aux activités de santé de {company}; chaque détenteur cède une action au cours du marché. Le fonds actif règle 1 M€ de frais.",
    "effect": "forcedSale",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "health",
    "quantity": 1
  },
  {
    "id": "board-15",
    "title": "Audit des participations croisées",
    "story": "Un audit des participations croisées liées à {company} impose la cession de deux actions par détenteur au cours du marché. Le fonds actif règle 1 M€ de frais.",
    "effect": "forcedSale",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "technology",
    "quantity": 2
  },
  {
    "id": "board-16",
    "title": "Liquidité sous surveillance",
    "story": "Une surveillance de liquidité dans la filière de {company} conduit chaque détenteur à céder une action au cours du marché. Le fonds actif règle 1 M€ de frais.",
    "effect": "forcedSale",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "agrifood",
    "quantity": 1
  },
  {
    "id": "board-17",
    "title": "Garantie de rachat",
    "story": "Un partenaire de transport rachète chaque titre détenu de {company} au cours du marché, avec une prime de 1 M€ par titre.",
    "effect": "buyback",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "transport",
    "amount": 1
  },
  {
    "id": "board-18",
    "title": "Appel de marge",
    "story": "Une forte volatilité sur {company} entraîne un dépôt de garantie de 2 M€ pour le fonds actif s’il détient cette société.",
    "effect": "marginCall",
    "activeCash": 0,
    "balanceCategory": "unfavorable",
    "targetSector": "finance",
    "amount": 2
  },
  {
    "id": "board-19",
    "title": "Collatéral déprécié",
    "story": "La baisse de valeur d’un collatéral énergétique lié à {company} entraîne un dépôt de garantie de 1 M€ si le fonds actif détient cette société.",
    "effect": "marginCall",
    "activeCash": 0,
    "balanceCategory": "unfavorable",
    "targetSector": "energy",
    "amount": 1
  },
  {
    "id": "board-20",
    "title": "Risque de change",
    "story": "Le renchérissement des contrats industriels liés à {company} entraîne un dépôt de garantie de 1 M€ si le fonds actif détient cette société.",
    "effect": "marginCall",
    "activeCash": 0,
    "balanceCategory": "unfavorable",
    "targetSector": "industry",
    "amount": 1
  },
  {
    "id": "board-21",
    "title": "Convocation judiciaire",
    "story": "Une enquête judiciaire liée à {company} convoque le gestionnaire actif; s’il détient cette société, il est placé en prison. Le fonds actif règle 1 M€ de frais.",
    "effect": "prison",
    "activeCash": -1,
    "balanceCategory": "unfavorable"
  },
  {
    "id": "board-22",
    "title": "Soupçon de délit d’initié",
    "story": "Après un examen des transactions dans le secteur de {company}, une règle de transparence limite les positions dominantes; le fonds actif reçoit 1 M€ et les monopoles médias cèdent une action par société concernée.",
    "effect": "regulation",
    "activeCash": 1,
    "balanceCategory": "mixed",
    "targetSector": "media",
    "quantity": 1
  },
  {
    "id": "board-23",
    "title": "Saisie préventive",
    "story": "Des pièces comptables sur {company} sont saisies pour expertise; les porteurs règlent 1 M€ de frais par titre détenu.",
    "effect": "fine",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "media",
    "amount": 1
  },
  {
    "id": "board-24",
    "title": "Plafond de détention",
    "story": "Un plafond de détention ouvre le marché industriel de {company}; le fonds actif reçoit 1 M€ et les monopoles du secteur cèdent une action par société concernée.",
    "effect": "regulation",
    "activeCash": 1,
    "balanceCategory": "mixed",
    "targetSector": "industry",
    "quantity": 1
  },
  {
    "id": "board-25",
    "title": "Accès équitable au réseau",
    "story": "Une règle d’accès équitable au réseau de {company} limite les positions dominantes; le fonds actif reçoit 1 M€ et les monopoles énergétiques cèdent une action par société concernée.",
    "effect": "regulation",
    "activeCash": 1,
    "balanceCategory": "mixed",
    "targetSector": "energy",
    "quantity": 1
  },
  {
    "id": "board-26",
    "title": "Fin du privilège exclusif",
    "story": "La fin d’un privilège exclusif autour de {company} ouvre le secteur de la santé; le fonds actif reçoit 1 M€ et les monopoles concernés cèdent une action par société.",
    "effect": "regulation",
    "activeCash": 1,
    "balanceCategory": "mixed",
    "targetSector": "health",
    "quantity": 1
  },
  {
    "id": "board-27",
    "title": "Indemnité de livraison",
    "story": "L’examen du retard de livraison concernant {company} est reporté; aucune indemnité ni charge n’est versée à ce stade.",
    "effect": "cash",
    "activeCash": 0,
    "balanceCategory": "mixed"
  },
  {
    "id": "board-28",
    "title": "Récolte sous assurance",
    "story": "Une assurance couvre les pertes de la filière liée à {company}; les porteurs reçoivent une distribution de 2 M€ par titre.",
    "effect": "dividend",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "agrifood",
    "amount": 2
  },
  {
    "id": "board-29",
    "title": "Accord de cybersécurité",
    "story": "La validation d’un plan de cybersécurité lié à {company} déclenche une indemnité de 2 M€ pour le fonds actif.",
    "effect": "cash",
    "activeCash": 2,
    "balanceCategory": "favorable",
    "targetSector": "technology"
  },
  {
    "id": "board-30",
    "title": "Licence médicale",
    "story": "Une nouvelle autorisation commerciale pour {company} ouvre un marché; les porteurs reçoivent 2 M€ par titre.",
    "effect": "dividend",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "health",
    "amount": 2
  },
  {
    "id": "board-31",
    "title": "Révision des normes comptables",
    "story": "Une révision comptable dans le secteur de {company} entraîne 1 M€ de frais par titre détenu.",
    "effect": "fine",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "finance",
    "amount": 1
  },
  {
    "id": "board-32",
    "title": "Conversion des entrepôts",
    "story": "Un investisseur rachète chaque titre détenu de {company} au cours du marché, avec une prime de 2 M€ par titre.",
    "effect": "buyback",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "realestate",
    "amount": 2
  },
  {
    "id": "board-33",
    "title": "Fret exceptionnel",
    "story": "Une mission de fret urgente mobilise {company}; le fonds actif reçoit une indemnité de disponibilité de 2 M€.",
    "effect": "cash",
    "activeCash": 2,
    "balanceCategory": "favorable",
    "targetSector": "transport"
  },
  {
    "id": "board-34",
    "title": "Couverture agricole",
    "story": "La couverture d’assurance de la filière liée à {company} laisse des frais de 1 M€ par titre détenu à la charge des porteurs.",
    "effect": "fine",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "agrifood",
    "amount": 1
  },
  {
    "id": "board-35",
    "title": "Violation de données",
    "story": "Une fuite de données liée à {company} entraîne 2 M€ de frais de notification et de sécurisation par titre détenu.",
    "effect": "fine",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "technology",
    "amount": 2
  },
  {
    "id": "board-36",
    "title": "Réparation du réseau",
    "story": "Le diagnostic de la panne sur le réseau lié à {company} est en cours; aucune réparation ni charge ne s’applique à ce stade.",
    "effect": "cash",
    "activeCash": 0,
    "balanceCategory": "mixed"
  },
  {
    "id": "board-37",
    "title": "Autorisation de distribution",
    "story": "Une licence de distribution liée à {company} génère une avance de 2 M€ au fonds actif.",
    "effect": "cash",
    "activeCash": 2,
    "balanceCategory": "favorable",
    "targetSector": "media"
  },
  {
    "id": "board-38",
    "title": "Simplification de la structure",
    "story": "Une simplification des participations croisées autour de {company} ouvre le secteur des transports; le fonds actif reçoit 1 M€ et les monopoles concernés cèdent une action par société.",
    "effect": "regulation",
    "activeCash": 1,
    "balanceCategory": "mixed",
    "targetSector": "transport",
    "quantity": 1
  },
  {
    "id": "board-39",
    "title": "Offre de coopérative",
    "story": "Une coopérative rachète chaque titre détenu de {company} au cours du marché, avec une prime de 1 M€ par titre.",
    "effect": "buyback",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "agrifood",
    "amount": 1
  },
  {
    "id": "board-40",
    "title": "Chambre de compensation",
    "story": "Une chambre de compensation relève les garanties sur les positions de {company}; le fonds actif dépose 2 M€ s’il détient cette société.",
    "effect": "marginCall",
    "activeCash": 0,
    "balanceCategory": "unfavorable",
    "targetSector": "transport",
    "amount": 2
  },
  {
    "id": "board-41",
    "title": "Diversification imposée",
    "story": "Une règle de diversification limite les positions dominantes autour de {company}; le fonds actif reçoit 1 M€ et les monopoles agroalimentaires cèdent une action par société concernée.",
    "effect": "regulation",
    "activeCash": 1,
    "balanceCategory": "mixed",
    "targetSector": "agrifood",
    "quantity": 1
  },
  {
    "id": "board-42",
    "title": "Clause de transparence",
    "story": "Une clause de transparence ouvre le marché de {company}; le fonds actif reçoit 1 M€ et les monopoles financiers cèdent une action par société concernée.",
    "effect": "regulation",
    "activeCash": 1,
    "balanceCategory": "mixed",
    "targetSector": "finance",
    "quantity": 1
  },
  {
    "id": "board-43",
    "title": "Commercialisation d’un vaccin",
    "story": "Après l’autorisation d’un produit de santé lié à {company}, les porteurs reçoivent une distribution de 2 M€ par titre.",
    "effect": "dividend",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "health",
    "amount": 2
  },
  {
    "id": "board-44",
    "title": "Contrôle des loyers",
    "story": "Une révision des baux associés à {company} entraîne 1 M€ de frais administratifs par titre détenu.",
    "effect": "fine",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "realestate",
    "amount": 1
  },
  {
    "id": "board-45",
    "title": "Archives judiciaires",
    "story": "Des archives sur les opérations de {company} sont examinées; si le fonds actif détient cette société, son gestionnaire est placé en prison. Le fonds actif règle 1 M€ de frais.",
    "effect": "prison",
    "activeCash": -1,
    "balanceCategory": "unfavorable",
    "targetSector": "transport"
  },
  {
    "id": "board-46",
    "title": "Redevances audiovisuelles",
    "story": "Les droits de contenus associés à {company} génèrent une recette ponctuelle de 2 M€ par titre détenu.",
    "effect": "dividend",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "media",
    "amount": 2
  },
  {
    "id": "board-47",
    "title": "Garantie de chantier",
    "story": "La réévaluation d’un chantier lié à {company} conduit le courtier à demander 2 M€ de garantie au fonds actif s’il détient cette société.",
    "effect": "marginCall",
    "activeCash": 0,
    "balanceCategory": "unfavorable",
    "targetSector": "realestate",
    "amount": 2
  },
  {
    "id": "board-48",
    "title": "Programme de recyclage",
    "story": "Un programme de recyclage industriel lié à {company} obtient une subvention de 1 M€ pour le fonds actif.",
    "effect": "cash",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "industry"
  },
  {
    "id": "board-49",
    "title": "Ouverture des brevets",
    "story": "L’ouverture des brevets liés à {company} stimule la concurrence; le fonds actif reçoit 1 M€ et les monopoles technologiques cèdent une action par société concernée.",
    "effect": "regulation",
    "activeCash": 1,
    "balanceCategory": "mixed",
    "targetSector": "technology",
    "quantity": 1
  },
  {
    "id": "board-50",
    "title": "Rachat du réseau local",
    "story": "Un opérateur rachète chaque titre détenu de {company} au cours du marché, avec une prime de 2 M€ par titre.",
    "effect": "buyback",
    "activeCash": 1,
    "balanceCategory": "favorable",
    "targetSector": "energy",
    "amount": 2
  }
];

module.exports = { BOARD_EVENT_CARDS };
