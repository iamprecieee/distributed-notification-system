import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import {
  ApiResponse as ApiResponseType,
  PaginationMeta,
} from '../../common/types/api-response.type';
import { UserPreference } from '../../common/types/user-preference.enum';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid input data' })
  @ApiResponse({ status: 409, description: 'Conflict - User already exists' })
  async create(
    @Body() createUserDto: CreateUserDto,
  ): Promise<ApiResponseType<UserResponseDto>> {
    const user = await this.usersService.create(createUserDto);

    return {
      success: true,
      message: 'User created successfully',
      data: user,
      meta: {
        total: 1,
        limit: 1,
        page: 1,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all users with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    type: [UserResponseDto],
  })
  @ApiBearerAuth('JWT-auth')
  async findAll(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
  ): Promise<ApiResponseType<UserResponseDto[]>> {
    const { users, total } = await this.usersService.findAll(page, limit);

    const total_pages = Math.ceil(total / limit);

    const meta: PaginationMeta = {
      total,
      limit,
      page,
      total_pages,
      has_next: page < total_pages,
      has_previous: page > 1,
    };

    return {
      success: true,
      message: 'Users retrieved successfully',
      data: users,
      meta,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID', type: String })
  @ApiResponse({
    status: 200,
    description: 'User found',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiBearerAuth('JWT-auth')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponseType<UserResponseDto>> {
    const user = await this.usersService.findOne(id);

    return {
      success: true,
      message: 'User retrieved successfully',
      data: user,
      meta: {
        total: 1,
        limit: 1,
        page: 1,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    };
  }

  @Get(':id/preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user notification preferences' })
  @ApiParam({ name: 'id', description: 'User UUID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Preferences retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiBearerAuth('JWT-auth')
  async getPreferences(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponseType<UserPreference>> {
    const preferences = await this.usersService.getPreferences(id);

    return {
      success: true,
      message: 'Preferences retrieved successfully',
      data: preferences,
      meta: {
        total: 1,
        limit: 1,
        page: 1,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user' })
  @ApiParam({ name: 'id', description: 'User UUID', type: String })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiBearerAuth('JWT-auth')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<ApiResponseType<UserResponseDto>> {
    const user = await this.usersService.update(id, updateUserDto);

    return {
      success: true,
      message: 'User updated successfully',
      data: user,
      meta: {
        total: 1,
        limit: 1,
        page: 1,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete user' })
  @ApiParam({ name: 'id', description: 'User UUID', type: String })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiBearerAuth('JWT-auth')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponseType<null>> {
    await this.usersService.remove(id);

    return {
      success: true,
      message: 'User deleted successfully',
      data: null,
      meta: {
        total: 0,
        limit: 0,
        page: 1,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    };
  }
}
