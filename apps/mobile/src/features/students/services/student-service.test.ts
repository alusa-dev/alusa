import { authenticatedApi } from '@/features/auth/services/auth-service';

import { studentService } from './student-service';

jest.mock('@/features/auth/services/auth-service', () => ({
  authenticatedApi: { request: jest.fn() },
}));

const requestMock = authenticatedApi.request as jest.Mock;

describe('studentService', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('carrega os detalhes pelo endpoint do aluno', async () => {
    requestMock.mockResolvedValue({ student: { id: 'student/1' } });

    await studentService.getStudent('student/1');

    expect(requestMock).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/mobile/students/student%2F1',
    });
  });

  it('envia edição e ações para a mesma rota protegida do aluno', async () => {
    requestMock.mockResolvedValue({ success: true });

    await studentService.updateStudent('student-1', { nome: 'Aluno' });
    await studentService.removeStudent('student-1', 'Solicitação do usuário');
    await studentService.reactivateStudent('student-1');

    expect(requestMock).toHaveBeenNthCalledWith(1, {
      method: 'PATCH',
      path: '/api/mobile/students/student-1',
      body: { nome: 'Aluno' },
    });
    expect(requestMock).toHaveBeenNthCalledWith(2, {
      method: 'POST',
      path: '/api/mobile/students/student-1',
      body: { action: 'DELETE', reason: 'Solicitação do usuário' },
    });
    expect(requestMock).toHaveBeenNthCalledWith(3, {
      method: 'POST',
      path: '/api/mobile/students/student-1',
      body: { action: 'REACTIVATE' },
    });
  });
});
