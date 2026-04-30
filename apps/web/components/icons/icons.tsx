// Centralização de ícones Heroicons (outline) para consistência e fácil troca futura.
// Convenção: usar nomes sem sufixo Icon para facilitar refactors e leitura sem ruído.
// Se precisar da versão solid, importe localmente e documente o motivo.

export {
  // Navegação / Estrutura
  Squares2X2Icon as Dashboard,
  AcademicCapIcon as Academic,
  BanknotesIcon as Finance,
  CalendarDaysIcon as Calendar,
  DocumentChartBarIcon as Reports,
  BuildingStorefrontIcon as StoreFront,
  BuildingLibraryIcon as BuildingLibrary,
  TicketIcon as Ticket,
  Cog6ToothIcon as Settings,
  // Usuário / Sessão
  UserCircleIcon as UserCircle,
  ArrowRightOnRectangleIcon as Logout,
  ArrowRightStartOnRectangleIcon as LogoutStart,
  UserPlusIcon as UserPlus,
  // Estados / Feedback
  CheckCircleIcon as CheckCircle,
  ExclamationCircleIcon as AlertCircle,
  ExclamationTriangleIcon as Warning,
  InformationCircleIcon as InfoCircle,
  QuestionMarkCircleIcon as Help,
  XCircleIcon as ErrorCircle,
  XMarkIcon as Close,
  // Ações / Controles
  MagnifyingGlassIcon as Search,
  BellIcon as Bell,
  ChevronDownIcon as ChevronDown,
  ChevronUpIcon as ChevronUp,
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  ArrowLeftIcon as ArrowLeft,
  ArrowLongLeftIcon as ArrowPrev,
  ArrowLongRightIcon as ArrowNext,
  CheckIcon as Check,
  MinusIcon as Minus,
  PencilSquareIcon as Edit,
  TrashIcon as Trash,
  ArchiveBoxIcon as Archive,
  ArrowUturnLeftIcon as ArchiveRestore,
  FunnelIcon as Filter,
  PlusIcon as Plus,
  CubeIcon as Package2,
  EnvelopeIcon as Mail,
  PhoneIcon as Phone,
  MapPinIcon as MapPin,
  EyeIcon as Eye,
  EyeSlashIcon as EyeOff,
  EllipsisVerticalIcon as MoreVertical,
  IdentificationIcon as IdCard,
  BookOpenIcon as BookOpen,
  ClipboardDocumentCheckIcon as ClipboardDocumentCheck,
  RectangleStackIcon as RectangleStack,
  ChartBarIcon as ChartBar,
  ShoppingBagIcon as ShoppingBag,
  ClockIcon as Clock,
  ArrowPathIcon as Refresh,
  SunIcon as Sun,
  MoonIcon as Moon,
  ArrowUpTrayIcon as Upload,
  ArrowDownTrayIcon as Download,
  ArrowTopRightOnSquareIcon as ExternalLink,
  ReceiptPercentIcon as Receipt,
  CreditCardIcon as CreditCard,
  CreditCardIcon as WalletCards,
  WalletIcon as Wallet,
  CurrencyDollarIcon as DollarSign,
  // Ações de compartilhamento/cópia
  DocumentDuplicateIcon as Copy,
  ShareIcon as Share2,
  // Documentos/Contratos
  DocumentTextIcon as DocumentText,
  DocumentDuplicateIcon as DocumentDuplicate,
} from '@heroicons/react/24/outline';

// Ícones adicionais / aliases semânticos centralizados
export {
  PencilSquareIcon as Edit3, // usado como Edit3
  TrashIcon as Trash2, // Trash já exportado; alias para Trash2
  ArrowPathIcon as RotateCcw, // alias para ação de reset
  ArrowPathIcon as Loader2, // alias para spinners leves
  WrenchIcon as Wrench, // ajustes / configurações avançadas
  UsersIcon as Users, // listagem de usuários / alunos
  UserIcon as User, // para campos de login
  XMarkIcon as X, // close genérico
  ChevronLeftIcon as ChevronsLeft, // fallback para duplo (não existe direto em heroicons)
  ChevronRightIcon as ChevronsRight, // fallback para duplo (não existe direto)
} from '@heroicons/react/24/outline';

// Reexportações com nomes originais (outline), para facilitar migração gradual
export {
  Squares2X2Icon,
  AcademicCapIcon,
  UserIcon,
  UsersIcon,
  BookOpenIcon,
  BuildingLibraryIcon,
  RectangleStackIcon,
  ClipboardDocumentCheckIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  ClockIcon,
  CubeIcon,
  CircleStackIcon,
  ArrowPathRoundedSquareIcon,
  TagIcon,
  TicketIcon,
  Cog6ToothIcon,
  ChevronLeftIcon,
  ChevronDownIcon,
  QuestionMarkCircleIcon,
  ArrowRightStartOnRectangleIcon,
  UserCircleIcon,
  SunIcon,
  MoonIcon,
  WalletIcon,
} from '@heroicons/react/24/outline';

// Variantes SOLID necessárias, exportadas com sufixo "Solid"
export {
  Squares2X2Icon as Squares2X2Solid,
  AcademicCapIcon as AcademicCapSolid,
  UserIcon as UserSolid,
  UsersIcon as UsersSolid,
  BookOpenIcon as BookOpenSolid,
  BuildingLibraryIcon as BuildingLibrarySolid,
  RectangleStackIcon as RectangleStackSolid,
  ClipboardDocumentCheckIcon as ClipboardDocumentCheckSolid,
  BanknotesIcon as BanknotesSolid,
  CalendarDaysIcon as CalendarDaysSolid,
  ChartBarIcon as ChartBarSolid,
  ShoppingBagIcon as ShoppingBagSolid,
  ShoppingCartIcon as ShoppingCartSolid,
  ClockIcon as ClockSolid,
  CubeIcon as CubeSolid,
  CircleStackIcon as CircleStackSolid,
  ArrowPathRoundedSquareIcon as ArrowPathRoundedSquareSolid,
  TagIcon as TagSolid,
  TicketIcon as TicketSolid,
  Cog6ToothIcon as Cog6ToothSolid,
  DocumentTextIcon as DocumentTextSolid,
  DocumentDuplicateIcon as DocumentDuplicateSolid,
  WalletIcon as WalletSolid,
} from '@heroicons/react/24/solid';
