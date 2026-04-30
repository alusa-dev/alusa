'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from '@/components/ui/toast';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { maskCep, maskPhone, maskCpfCnpj } from '@alusa/lib/client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export { WizardStep2IdentificationForm as WizardStep2Form } from './WizardStep2IdentificationForm';
import { saveWizardStep2, WizardApiError, saveWizardStep3 } from './wizard-service';
