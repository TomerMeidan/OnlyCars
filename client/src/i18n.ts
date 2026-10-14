import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

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
  showArchived: 'הצג רכבים בארכיון',
  archived: 'בארכיון',
  archive: 'העבר לארכיון',
  unarchive: 'החזר מהארכיון',
  edit: 'עריכה',
  save: 'שמירה',
  cancel: 'ביטול',
  nickname: 'כינוי',
  make: 'יצרן',
  model: 'דגם',
  year: 'שנה',
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
  confirmCorrection: 'זה תיקון, שמור בכל זאת',
  fuel: { Petrol: 'בנזין', Diesel: 'דיזל', Hybrid: 'היברידי', Electric: 'חשמלי', Lpg: 'גפ״מ', Other: 'אחר' },
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

export default i18n
