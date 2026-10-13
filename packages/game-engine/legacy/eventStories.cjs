'use strict';

// Chaque amorce suit le titre de la carte. Les conséquences sont racontées
// séparément à partir des indices réellement obtenus pendant la partie.
const STORIES = [
  null,
  'En {zone}, les carnets de commandes se remplissent et les fournisseurs de {sector} prolongent leurs équipes.',
  'Des chantiers longtemps bloqués redémarrent en {zone} ; les entreprises de {sector} réembauchent.',
  'Un nouveau budget public est voté en {zone} et promet des débouchés aux acteurs de {sector}.',
  'Une découverte de ressources en {zone} mobilise les banques qui financent son exploitation.',
  'Les usines d’{zone} rouvrent des lignes de production ; les prêteurs accompagnent leur reprise.',
  'De nouveaux marchés s’ouvrent en {zone} et les investisseurs s’intéressent aux entreprises de {sector}.',
  'Les comptes publiés en {zone} surprennent les analystes et relancent les projets de {sector}.',
  'Un laboratoire d’{zone} présente une percée ; les groupes de {sector} préparent son déploiement.',
  'Un accord d’approvisionnement conclu en {zone} rassure les financeurs des prochains projets.',
  'Les entreprises d’{zone} publient de meilleurs comptes ; les sociétés de {sector} revoient leurs prévisions.',
  'Un grand accord commercial ouvre des routes en {zone} et facilite l’accès aux produits de {sector}.',
  'De nouvelles sociétés entrent en Bourse en {zone} et lèvent des fonds pour leurs activités de {sector}.',
  'Un plan climat est annoncé en {zone} ; les banques organisent le financement de la transition.',
  'Les banques d’{zone} assouplissent le crédit et les entreprises de {sector} relancent leurs projets.',
  'Une vague de commandes de composants traverse {zone} et remplit les ateliers de {sector}.',
  'De nouveaux prêts deviennent accessibles en {zone} et les jeunes entreprises de {sector} accélèrent.',
  'La banque centrale surprend {zone} avec une baisse des taux ; les sociétés de {sector} révisent leurs plans.',
  'Les dirigeants d’{zone} annoncent davantage d’investissements et réservent des capacités dans {sector}.',
  'Les monnaies se stabilisent en {zone} ; les entreprises de {sector} peuvent enfin chiffrer leurs contrats.',
  'Un cadre plus lisible est adopté en {zone} et les sociétés de {sector} reprennent des projets suspendus.',
  'L’État lance un programme d’investissement en {zone} et commande de nouveaux équipements à {sector}.',
  'Les exportateurs agricoles d’{zone} signent des contrats ; la demande de {sector} suit leur croissance.',
  'Un partenariat public-privé finance de nouveaux sites en {zone} et donne du travail à {sector}.',
  'Les investisseurs acceptent davantage de risque en {zone} et soutiennent les paris de {sector}.',
  'Les transactions immobilières repartent en {zone} ; les banques renégocient et financent les projets.',
  'Le prix des matières premières rebondit en {zone} et les producteurs de {sector} relancent leurs forages.',
  'Une série d’achats entraîne la Bourse d’{zone} ; les valeurs de {sector} concentrent les échanges.',
  'Une avancée médicale est annoncée en {zone} ; les banques financent les essais et leur industrialisation.',
  'Les ménages d’{zone} reprennent confiance et les projets de {sector} trouvent de nouveaux clients.',
  'Un allègement fiscal entre en vigueur en {zone} et libère des moyens pour les entreprises de {sector}.',
  'Les réservations touristiques affluent en {zone} ; les services de {sector} préparent la saison.',
  'Des capitaux étrangers arrivent en {zone} et les banques les orientent vers les entreprises locales.',
  'Les exportateurs d’{zone} remplissent leurs carnets ; les usines de {sector} augmentent leurs cadences.',
  'Les ateliers d’{zone} produisent davantage avec les mêmes moyens et les groupes de {sector} investissent.',
  'Des chaînes de production redémarrent en {zone}, entraînant une nouvelle demande adressée à {sector}.',
  'Une pénurie d’électricité interrompt des sites en {zone} et prive les entreprises de {sector} de capacité.',
  'Deux trimestres de contraction sont annoncés en {zone} ; les commandes de {sector} sont reportées.',
  'Plusieurs usines ferment temporairement en {zone} et la demande adressée à {sector} se grippe.',
  'Les défauts de paiement augmentent en {zone} ; les banques resserrent leurs critères de crédit.',
  'Les récoltes manquent en {zone} ; les banques provisionnent les prêts des distributeurs fragilisés.',
  'Une série de mauvais résultats secoue {zone} et les investisseurs désertent les valeurs de {sector}.',
  'Des dégâts climatiques frappent {zone} et interrompent des infrastructures indispensables à {sector}.',
  'Les coûts de production montent en {zone} ; les industriels de {sector} réduisent leurs marges.',
  'Une forte instabilité monétaire renchérit les importations en {zone} et les achats des groupes de {sector}.',
  'Un changement imprévu des règles en {zone} inquiète les banques et retarde leurs financements.',
  'Des investisseurs retirent leurs capitaux d’{zone} et les projets de {sector} cherchent des fonds.',
  'Les ventes immobilières se figent en {zone} ; les entreprises de {sector} repoussent leurs investissements.',
  'Des ports saturés retardent les livraisons en {zone} et désorganisent les chaînes de {sector}.',
  'Les comptes publiés en {zone} déçoivent ; les groupes de {sector} abaissent leurs objectifs.',
  'Un défaut découvert après livraison impose des rappels en {zone} et arrête des lignes de {sector}.',
  'Les factures d’énergie et de transport gonflent en {zone} ; les marges de {sector} s’érodent.',
  'Les grands fonds quittent {zone} et les banques doivent trouver de nouveaux prêteurs.',
  'Un changement politique soudain suspend des projets en {zone} et inquiète les producteurs de {sector}.',
  'Les banques d’{zone} peinent à se refinancer et réduisent brutalement leurs nouveaux prêts.',
  'Les enquêtes de confiance se dégradent en {zone} ; les clients de {sector} reportent leurs achats.',
  'Le déficit public atteint un record en {zone} et le financement des projets de {sector} devient incertain.',
  'Une hausse brutale des taux renchérit le crédit en {zone} et pèse sur les usines de {sector}.',
  'De nouvelles sanctions coupent des circuits de paiement en {zone} et compliquent le travail des banques.',
  'La flambée du pétrole alourdit les coûts en {zone} et réduit les budgets disponibles pour {sector}.',
  'Une banque importante vacille en {zone} ; les entreprises de {sector} cherchent d’urgence d’autres prêteurs.',
  'Des droits de douane apparaissent en {zone} et ferment des débouchés aux entreprises de {sector}.',
  'Une chute des devises renchérit les machines importées en {zone} et bloque des usines de {sector}.',
  'Une grève générale interrompt les transports en {zone} et immobilise les chaînes de {sector}.',
  'Les commandes étrangères se raréfient en {zone} ; les entreprises de {sector} revoient leurs budgets.',
  'Des négociations commerciales échouent en {zone} et les industriels de {sector} perdent des contrats.',
  'Une cyberattaque paralyse des réseaux en {zone} et bloque des usines de {sector}.',
  'Une vague de ventes panique les opérateurs en {zone} ; même les valeurs de {sector} sont entraînées.',
  'Une crise politique brouille les prévisions en {zone} et retarde les investissements de {sector}.',
  'La dette publique inquiète les créanciers d’{zone} et les groupes de {sector} paient leur crédit plus cher.',
  'Des ordres contradictoires secouent les places d’{zone} et les producteurs de {sector} hésitent à investir.',
  'Les flux commerciaux se normalisent en {zone} et les entreprises de {sector} ajustent leurs stocks.',
  'Les investisseurs observent les prochaines statistiques d’{zone} avant de se positionner dans {sector}.',
  'Les séances deviennent moins agitées en {zone} et les sociétés de {sector} retrouvent de la visibilité.',
  'Les portefeuilles se rééquilibrent en {zone} ; les banques revoient leurs allocations de prêts.',
  'Une transition économique progresse sans heurt en {zone} et les usines de {sector} adaptent leur calendrier.',
  'Après plusieurs séances tendues, les échanges se calment en {zone} et les banques rouvrent leurs guichets.',
  'Les autorités marquent une pause réglementaire en {zone} ; les producteurs de {sector} attendent les arbitrages.',
  'Des indicateurs opposés arrivent d’{zone} ; les banques attendent des données plus nettes.',
  'La banque centrale diffère sa décision en {zone} ; les prêteurs gardent leurs conditions actuelles.',
  'Un budget sans surprise est adopté en {zone} et les usines de {sector} poursuivent leurs plans.',
  'Des flux clients inexpliqués déclenchent une enquête en {zone}, sur fond de soupçons rappelant des fraudes pyramidales documentées.',
  'Des créances sans activité économique identifiable apparaissent dans un dossier de {zone} ; les auditeurs demandent des justificatifs.',
  'Une fuite d’informations avant une annonce officielle conduit les autorités de {zone} à examiner les contrôles de marché.',
  'Des transactions anticipent une annonce publique en {zone} ; les autorités vérifient si les règles de marché ont été respectées.',
  'Une perte jusque-là mal documentée est réexaminée par les auditeurs d’un établissement de {zone}.',
  'Un examen de gouvernance en {zone} met l’accent sur les conflits d’intérêts dans l’attribution de contrats.',
  'Des ordres coordonnés anormaux font l’objet d’une enquête sur une place de {zone} ; les contrôles de marché sont renforcés.',
  'Des opérations réalisées avant une annonce sensible sont examinées dans une enquête pour délit d’initié en {zone}.',
  'Des écarts entre pièces justificatives et écritures comptables sont découverts dans un dossier de {zone}.',
  'Une enquête sur des soupçons de blanchiment conduit les autorités de {zone} à renforcer la traçabilité des paiements.',
  'Une étude de marché sur {sector} relance le débat sur la séparation d’activités dominantes.',
  'Les autorités publient une revue générale de la concurrence dans {sector} ; les marchés évaluent les coûts possibles de conformité.',
  'Un projet de fusion dans {sector} fait l’objet d’un examen réglementaire, comme dans les procédures de concentration historiques.',
  'Après plusieurs crises sectorielles, de nouveaux contrôles sont proposés pour {sector}.',
  'Les autorités précisent les critères d’examen des acquisitions dans {sector}, ajoutant de l’incertitude aux projets en cours.',
  'Une réforme durcit l’application du droit de la concurrence dans {sector} et pousse les acteurs à revoir leurs contrats.',
  'Un dispositif temporaire de contrôle des prix est débattu pour {sector}, ravivant le débat sur la protection des consommateurs.',
  'Les régulateurs examinent des limites de détention dans {sector} afin de réduire les risques de concentration.',
  'Une enquête sectorielle sur {sector} vérifie les pratiques commerciales et les barrières à l’entrée.',
  'Une consultation réglementaire sur les plateformes de {sector} demande davantage de transparence sur l’accès au marché.',
];

function eventPremise(event, zoneName, sectorName) {
  if (typeof event.description === 'string' && event.description.trim()) return event.description;
  const template = STORIES[Number(event.id)];
  if (!template) {
    const title = String(event.title || 'Un changement inattendu').replace(/[.!?]+$/, '');
    return zoneName === 'la région concernée'
      ? `La nouvelle « ${title} » circule sur les marchés et attire l’attention des investisseurs.`
      : `La nouvelle « ${title} » circule en ${zoneName} et attire l’attention des investisseurs de ${sectorName}.`;
  }
  const sector = String(sectorName || 'ce secteur').toLocaleLowerCase('fr-FR');
  const sectorAwareTemplate = template
    .replaceAll('de {sector}', 'du secteur {sector}')
    .replaceAll('dans {sector}', 'dans le secteur {sector}')
    .replaceAll('pour {sector}', 'pour le secteur {sector}')
    .replaceAll('à {sector}', 'au secteur {sector}');
  return sectorAwareTemplate.replaceAll('{zone}', zoneName).replaceAll('{sector}', sector);
}

module.exports = { eventPremise };
