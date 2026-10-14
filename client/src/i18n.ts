import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { ApiError } from './api'

const en = {
  appName: 'OnlyCars',
  login: 'Log in',
  register: 'Create account',
  logout: 'Log out',
  email: 'Email',
  password: 'Password',
  noAccount: "Don't have an account?",
  haveAccount: 'Already have an account?',
  myCars: 'My cars',
  addCar: 'Add car',
  editCar: 'Edit car',
  noCars: 'No cars yet. Add your first one.',
  showArchived: 'Show archived',
  archived: 'Archived',
  archive: 'Archive',
  unarchive: 'Unarchive',
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  nickname: 'Nickname',
  make: 'Make',
  model: 'Model',
  year: 'Year',
  vin: 'VIN',
  plate: 'Plate',
  fuelType: 'Fuel type',
  purchaseDate: 'Purchase date',
  purchasePrice: 'Purchase price',
  initialOdometer: 'Current odometer (km)',
  odometer: 'Odometer',
  newReading: 'New reading in km',
  plateValue: 'Plate {{plate}}',
  intro: 'Track mileage and upkeep for every car you own.',
  km: 'km',
  kmPerDay: '{{value}} km/day',
  updateOdometer: 'Update',
  confirmCorrection: 'This is a correction, save anyway',
  fuel: { Petrol: 'Petrol', Diesel: 'Diesel', Hybrid: 'Hybrid', Electric: 'Electric', Lpg: 'LPG', Other: 'Other' },
  loading: 'Loading…',
  backToCars: 'All cars',
  odometerHistory: 'Odometer history',
  noReadings: 'No readings yet.',
  delete: 'Delete',
  readingValue: 'Reading in km',
  readingDate: 'Date',
  editReading: 'Edit reading {{value}} km',
  deleteReading: 'Delete reading {{value}} km',
  confirmDeleteReading: 'Delete this reading?',
  currency: 'Currency',
  source: { Manual: 'Manual', Service: 'Service', Checklist: 'Checklist', Fuel: 'Fuel' },
  // Keyed by the API's ProblemDetails `code`; unknown codes fall back to `generic`.
  errors: {
    generic: 'Something went wrong. Please try again.',
    auth: {
      invalidCredentials: 'Wrong email or password.',
      emailTaken: 'An account with this email already exists.',
      invalidEmail: 'Enter a valid email address.',
      passwordTooShort: 'The password must be at least 8 characters.',
      credentialsRequired: 'Enter your email and password.',
      invalidCurrency: 'Choose one of the listed currencies.',
    },
    vehicle: {
      vinTaken: 'Another car on your account already has this VIN.',
      notFound: 'This car was not found.',
    },
    odometer: {
      lowerThanPrevious:
        'This reading is lower than the reading before it ({{previousKm, number}} km). If it is a correction, tick the box and save again.',
      higherThanNext:
        'This reading is higher than the reading after it ({{nextKm, number}} km). If it is a correction, tick the box and save again.',
      futureDate: "The date can't be in the future.",
      invalidValue: "Enter a reading between 0 and 10,000,000 km.",
      onlyReading: "This is the car's only reading, so it can't be deleted. Edit it instead.",
      notManual: "This reading comes from another record and can't be changed here.",
    },
    odometerReading: {
      notFound: 'This reading was not found.',
    },
  },
}

const he: typeof en = {
  appName: 'OnlyCars',
  login: 'התחברות',
  register: 'יצירת חשבון',
  logout: 'התנתקות',
  email: 'אימייל',
  password: 'סיסמה',
  noAccount: 'אין לך חשבון?',
  haveAccount: 'כבר יש לך חשבון?',
  myCars: 'הרכבים שלי',
  addCar: 'הוספת רכב',
  editCar: 'עריכת רכב',
  noCars: 'עדיין אין רכבים. הוסיפו את הראשון.',
  showArchived: 'הצגת רכבים בארכיון',
  archived: 'בארכיון',
  archive: 'העברה לארכיון',
  unarchive: 'החזרה מהארכיון',
  edit: 'עריכה',
  save: 'שמירה',
  cancel: 'ביטול',
  nickname: 'כינוי',
  make: 'יצרן',
  model: 'דגם',
  year: 'שנת ייצור',
  vin: 'מספר שלדה',
  plate: 'מספר רישוי',
  fuelType: 'סוג דלק',
  purchaseDate: 'תאריך רכישה',
  purchasePrice: 'מחיר רכישה',
  initialOdometer: 'קילומטראז׳ נוכחי (ק״מ)',
  odometer: 'קילומטראז׳',
  newReading: 'קריאה חדשה בק״מ',
  plateValue: 'מספר רישוי {{plate}}',
  intro: 'מעקב אחר קילומטראז׳ ותחזוקה לכל הרכבים שלך.',
  km: 'ק״מ',
  kmPerDay: '{{value}} ק״מ ליום',
  updateOdometer: 'עדכון',
  confirmCorrection: 'זה תיקון, לשמור בכל זאת',
  fuel: { Petrol: 'בנזין', Diesel: 'דיזל', Hybrid: 'היברידי', Electric: 'חשמלי', Lpg: 'גפ״מ', Other: 'אחר' },
  loading: 'טוען…',
  backToCars: 'כל הרכבים',
  odometerHistory: 'היסטוריית קילומטראז׳',
  noReadings: 'עדיין אין קריאות.',
  delete: 'מחיקה',
  readingValue: 'קריאה בק״מ',
  readingDate: 'תאריך',
  editReading: 'עריכה של הקריאה {{value}} ק״מ',
  deleteReading: 'מחיקה של הקריאה {{value}} ק״מ',
  confirmDeleteReading: 'למחוק את הקריאה הזו?',
  currency: 'מטבע',
  source: { Manual: 'ידני', Service: 'טיפול', Checklist: 'רשימת בדיקה', Fuel: 'תדלוק' },
  // ⁦…⁩ isolate numbers so they stay left-to-right inside RTL text.
  errors: {
    generic: 'משהו השתבש. נסו שוב.',
    auth: {
      invalidCredentials: 'האימייל או הסיסמה שגויים.',
      emailTaken: 'כבר קיים חשבון עם האימייל הזה.',
      invalidEmail: 'הזינו כתובת אימייל תקינה.',
      passwordTooShort: 'הסיסמה חייבת להכיל לפחות 8 תווים.',
      credentialsRequired: 'הזינו אימייל וסיסמה.',
      invalidCurrency: 'בחרו אחד מהמטבעות ברשימה.',
    },
    vehicle: {
      vinTaken: 'בחשבון שלך כבר יש רכב עם מספר השלדה הזה.',
      notFound: 'הרכב לא נמצא.',
    },
    odometer: {
      lowerThanPrevious:
        'הקריאה נמוכה מהקריאה שלפניה (⁦{{previousKm, number}}⁩ ק״מ). אם זה תיקון, סמנו את התיבה ושמרו שוב.',
      higherThanNext:
        'הקריאה גבוהה מהקריאה שאחריה (⁦{{nextKm, number}}⁩ ק״מ). אם זה תיקון, סמנו את התיבה ושמרו שוב.',
      futureDate: 'התאריך לא יכול להיות בעתיד.',
      invalidValue: 'הזינו קריאה בין ⁦0⁩ ל־⁦10,000,000⁩ ק״מ.',
      onlyReading: 'זו הקריאה היחידה של הרכב, ולכן אי אפשר למחוק אותה. אפשר לערוך אותה.',
      notManual: 'הקריאה הזו מגיעה מרשומה אחרת, ואי אפשר לשנות אותה כאן.',
    },
    odometerReading: {
      notFound: 'הקריאה לא נמצאה.',
    },
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, he: { translation: he } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'he'],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
  })

const applyDir = (lng: string) => {
  document.documentElement.lang = lng
  document.documentElement.dir = i18n.dir(lng)
}
applyDir(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', applyDir)

// Translated text for any thrown error: known API codes get their own message, everything else the generic one.
export function errorMessage(err: unknown) {
  const problem = err instanceof ApiError ? err.problem : {}
  return i18n.t(`errors.${problem.code}`, { previousKm: problem.previousKm, nextKm: problem.nextKm, defaultValue: i18n.t('errors.generic') })
}

export default i18n
